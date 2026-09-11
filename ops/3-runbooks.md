# Operational Runbooks — TaskFlow

**Status:** executable procedures, verified against this repository and against
production on 2026-09-10.
**Scope:** TaskFlow Kanban (Next.js 16 on Vercel + Supabase). This replaces an
earlier version of this document that described a BullMQ worker fleet, a
self-hosted Redis/ElastiCache cluster, Gmail API service accounts, Google Cloud
Pub/Sub and Kubernetes replicas. None of that exists here, so none of those
commands could be run.

> **Migration note:** the account-bound values below (Supabase project ref
> `txdyijyswpsalqnwfopc`, the Vercel project/org IDs, the domain
> `task.conto.ec`, the GitHub repo) belong to the **current** accounts. If the
> project moves to different accounts, see [`MIGRACION.md`](../MIGRACION.md).

---

## 0. What this system actually is

Knowing the real shape of the system is what makes the runbooks below short.

| Piece | Reality |
|---|---|
| App | Next.js 16 App Router, deployed as Vercel serverless functions |
| Database / auth / storage / RLS | Supabase project `txdyijyswpsalqnwfopc` |
| Email | Resend (`RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`) |
| Notification delivery | **Synchronous**, in the caller's request (`src/lib/notifications/notify.ts`). There is no queue and no worker. Failures are written to `public.failed_jobs`. |
| Redis | Upstash, used **only** for rate limiting (`src/lib/rate-limit.ts`). Not a queue, not a cache of app data. |
| Scheduled work | **Two separate systems** — see 0.1 |
| Error tracking | Sentry (`@sentry/nextjs`), optional |
| Logs | Vercel Function logs (`vercel logs`) + Supabase logs in the dashboard |

There is no Kubernetes, no BullMQ, no `redis-cli` host, no self-hosted Postgres
you can `psql` into as an operator, and no Datadog/CloudWatch/PagerDuty
integration. Do not write runbook steps that assume them.

### 0.1 Two cron systems — do not confuse them

* **Vercel Cron** — exactly **one** job, in `vercel.json`:
  `/api/cron/alert-check` on `0 8 * * *` (daily, 08:00 UTC). It is the
  *alerting* job: it re-runs the health checks and POSTs to
  `ALERT_WEBHOOK_URL` if anything is wrong. It does no data work.
* **pg_cron inside Postgres** — the 7 jobs listed in `src/lib/cron-jobs.ts`
  (`MONITORED_JOBS`). These do the real recurring work (due-soon
  notifications, due-date/SLA automations, recurring tasks, audit-log purge,
  daily metrics snapshots, CRM sync response resolution). They are created by
  `cron.schedule(...)` calls inside `supabase/migrations/`.

Because alert-check only runs once a day, **a pg_cron failure can go unnoticed
for up to 24 hours.** See section 8.

---

## 1. Prerequisites for every runbook here

```bash
# CLIs
vercel --version
supabase --version
curl --version        # every health probe below is plain curl + jq
jq --version
```

Access a responder needs:

* Vercel access to project `taskflow-kanban-prototype`
  (projectId `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`,
  orgId `team_LUyGoTDapYDMjHCRVzQaFiaX`).
* Supabase dashboard access to project `txdyijyswpsalqnwfopc` (the SQL editor
  is where most database-side investigation happens — there is no operator
  `psql` shell).
* GitHub write access to `xaviercabrerau/taskflow-kanban-prototype`.
* Optional: Resend and Sentry dashboard access.

Secrets are never in this document. Only environment variable **names** appear.
Values live in Vercel project settings and in the source services.

---

## 2. First response — the 60-second triage

Run these three, in this order, before diagnosing anything:

```bash
# 1. Is the app up and can it reach Supabase?
curl -s https://task.conto.ec/api/health | jq
# Expected: {"status":"ok","checks":{"supabase":{"ok":true,"latencyMs":<n>}},"timestamp":"..."}
# 503 + "status":"error" means Supabase is unreachable or rejecting the probe.

# 2. Are the pg_cron jobs running?
curl -s https://task.conto.ec/api/health/cron | jq
# Expected: {"status":"ok","jobs":[ ...7 entries... ],"timestamp":"..."}
# "degraded" (HTTP 503) means at least one job is stale or last ran "failed".

# 3. Is the page itself serving?
curl -s -o /dev/null -w '%{http_code}\n' https://task.conto.ec/
```

Then map the result:

| Result | Go to |
|---|---|
| `/api/health` non-200 | §3 App or Supabase down |
| `/api/health/cron` degraded | §4 pg_cron job stale or failing |
| Both OK but users report errors | §5 Errors in a specific flow |
| Emails not arriving | §6 Email delivery |
| `429` from the API | §7 Rate limiting |
| Started right after a deploy | §9 Bad deploy — roll back |

---

## 3. Runbook: app returns errors / `/api/health` is not `ok`

**Symptom:** `/api/health` returns 503, or the site 500s.

### 3.1 Read the response — it tells you which half is broken

```bash
curl -s -i https://task.conto.ec/api/health
```

`/api/health` does exactly one thing (`src/app/api/health/route.ts`): it creates
an **anon** Supabase client and runs `select id from permissions limit 1`.
`permissions` is a global, non-tenant catalog whose RLS policy is readable by
anon on purpose, so the probe never depends on a user session.

That means:

* `{"status":"error", ... "message": "..."}` → Next.js is running; **Supabase**
  is the problem (network, project paused, RLS/grant change, credentials).
* No JSON at all / Vercel error page → the **function or the deployment** is
  the problem.
* `"NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"` → the
  env vars are missing in that Vercel environment. Note: env vars are baked in
  at build time, so after fixing them you must **redeploy**, not just restart.

### 3.2 Check the platform status

```bash
vercel ls                      # is the latest production deployment READY?
vercel logs <deployment-url>   # runtime errors from the function
```

Supabase: dashboard → project `txdyijyswpsalqnwfopc` → is the project active
(free-tier projects can be paused), and are there errors in Logs → API / Postgres?

### 3.3 Check the env vars are still present

```bash
vercel env ls production        # prints NAMES only, never values
```

Compare against `.env.example`, which is the authoritative list of names.
Minimum for the app to boot: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_APP_URL`.

### 3.4 Resolve

* Bad deploy → §9.
* Supabase paused/unhealthy → restore/resume in the dashboard; if the project
  is lost, `ops/4-backup-disaster-recovery.md` §6.2 and §7.2.
* Env var missing → re-add it in Vercel, then `vercel deploy --prod`.

### 3.5 Verify

```bash
curl -s https://task.conto.ec/api/health | jq '.status'   # "ok"
curl -s -o /dev/null -w '%{http_code}\n' https://task.conto.ec/   # 200
```

---

## 4. Runbook: pg_cron job stale or failing

**Symptom:** `/api/health/cron` returns `"status":"degraded"` (HTTP 503), or the
daily alert-check webhook fired with `Cron job "..." is stale`.

### 4.1 Identify which job

```bash
curl -s https://task.conto.ec/api/health/cron | jq '.jobs[] | select(.isStale or .lastStatus=="failed")'
```

The endpoint calls the `get_cron_health()` SECURITY DEFINER RPC, which reads
`cron.job_run_details` inside Postgres and only ever returns the job names
hardcoded in the migration. The canonical list the app compares against is
`src/lib/cron-jobs.ts` (`MONITORED_JOBS`):

| Job | Expected | What breaks if it stops |
|---|---|---|
| `taskflow_check_due_soon_tasks` | hourly | No "due soon" notifications |
| `taskflow_execute_due_date_automations` | hourly | Due-date automation rules don't fire |
| `taskflow_execute_sla_automations` | hourly | SLA automation rules don't fire |
| `taskflow_execute_recurring_tasks` | hourly | Recurring tasks are not created |
| `purge-expired-audit-logs` | daily (~03:00 UTC) | Audit log grows unbounded |
| `record-daily-metrics-snapshots` | daily (~03:10 UTC) | Dashboard/report history has gaps |
| `taskflow_resolve_crm_sync_responses` | every minute | CRM `external_ticket_id` never resolved |

### 4.2 Investigate in the Supabase SQL editor

```sql
-- Last 20 runs of the failing job (replace the name).
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
where command like '%taskflow_check_due_soon_tasks%'
order by start_time desc
limit 20;

-- Is the job still scheduled at all?
select jobid, jobname, schedule, active from cron.job order by jobname;
```

Common causes, in the order they actually happen:

1. **The job was never (re)created** — e.g. the database was rebuilt and a
   migration that calls `cron.schedule(...)` was not applied. Fix: `supabase db
   push` from the repo. Never create the schedule by hand; the schedule lives
   in `supabase/migrations/`.
2. **The job function errors** — `return_message` shows the Postgres error.
   Fix the underlying function via a **new migration file**; project rule:
   schema changes only through versioned migrations, never loose SQL.
3. **A new job was added but not registered for monitoring.** If a job exists in
   `cron.job` but not in the health output, it is invisible to alerting. It must
   be added to *both* `src/lib/cron-jobs.ts` and the `monitored_jobs` list in
   `get_cron_health()` (see `supabase/migrations/20260903200000_audit_fase_a_security_fixes.sql`).
   This exact mismatch already happened once with
   `taskflow_execute_recurring_tasks`.

### 4.3 Note on false positives

A **freshly restored or newly deployed** database legitimately reports
`degraded` until each job has run once: hourly jobs within the hour, daily jobs
after 03:00/03:10 UTC. Wait one cycle before escalating.

### 4.4 Verify

```bash
curl -s https://task.conto.ec/api/health/cron | jq '{status, stale: [.jobs[]|select(.isStale)]|length}'
# {"status":"ok","stale":0}
```

---

## 5. Runbook: errors in a specific user flow

**Symptom:** the app is up, health is `ok`, but a particular action fails for
users (creating a task, importing, sharing, an admin screen).

### 5.1 Get the real error

```bash
# Function logs for the current production deployment
vercel logs <deployment-url> | tail -100
```

If Sentry is configured (`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`), the issue
stream is faster — but note two real limitations documented in
`ops/7-error-tracking-config.md`: the browser SDK is loaded lazily (first user
interaction, or 5s after paint), so **very early client-side crashes are not
reported**, and `tracesSampleRate` is `0.1`.

### 5.2 Check whether it is a permissions problem, not a bug

This is the single most common false alarm in this project, because
`org_role` and RBAC are **separate systems**:

* `organization_members.org_role` (owner/admin/member/guest) does **not** by
  itself grant granular permissions such as `task.create`.
* Real permissions come from `role_assignments` (one row per board, `role_id` →
  `roles`), and the RLS policies for content mutations check
  `role_assignments`, not `org_role`.

So "the owner cannot create a task" is usually a missing role assignment, not a
broken endpoint. Check in the SQL editor:

```sql
select ra.board_id, r.name, rp.permission_id
from role_assignments ra
join roles r on r.id = ra.role_id
left join role_permissions rp on rp.role_id = r.id
where ra.user_id = '<uuid>';
```

Two more RLS behaviours that look like bugs:

* `profiles_update_own` restricts UPDATE to `id = auth.uid()`. An owner editing
  **another** user's name with the normal client updates **0 rows and throws no
  error**. That path must use a service-role client.
* `organization_members` has `UNIQUE(organization_id, user_id)` — a user can
  belong to several organizations, so membership queries must filter by
  organization, not only by user.

### 5.3 Reproduce locally against the same code

```bash
npm ci
npm test                 # 15 suites / 215 tests currently green
npx tsc --noEmit
npm run dev
```

If `npm test` is red on `main`, treat that as the incident.

---

## 6. Runbook: email notifications not arriving

**Symptom:** a user should have received an email (mention, status change) and
did not.

### 6.1 Understand the path — there is no queue to inspect

`src/lib/notifications/notify.ts` sends **synchronously** inside the request
that triggered it. The two wired event types (`task_mentioned`,
`status_changed`) are fired from **Postgres triggers** via `net.http_post` to
`/api/internal/notify-event` (migration
`20260828190100_wire_email_notifications_via_triggers.sql`), authenticated with
`INTERNAL_NOTIFY_SECRET`. Delivery is best-effort by design: a notification
failure must never fail the underlying action.

So the chain to check is: **trigger → `/api/internal/notify-event` → Resend**.

### 6.2 Check `failed_jobs` first

```sql
select * from public.failed_jobs order by created_at desc limit 20;
```

This table is the notification path's own error trail. A row here tells you the
send was attempted and failed, and why.

### 6.3 Check the in-app notification was created

```sql
select id, user_id, type, created_at
from public.notifications
where user_id = '<uuid>'
order by created_at desc limit 20;
```

* Row exists, no email → Resend/`notification_preferences` problem (§6.4).
* No row at all → the trigger never fired or `/api/internal/notify-event`
  rejected the payload. Check Vercel logs for that route, and confirm
  `INTERNAL_NOTIFY_SECRET` is set in the environment.

### 6.4 Check preferences and the provider

```sql
select * from public.notification_preferences where user_id = '<uuid>';
```

If the user opted out of that channel/event, nothing is wrong.

Otherwise, in the Resend dashboard: is `RESEND_API_KEY` valid, is the sending
domain for `NOTIFICATION_FROM_EMAIL` still verified, and does the message
appear as delivered/bounced/spam? A domain whose DNS moved (see
[`MIGRACION.md`](../MIGRACION.md)) will silently stop sending.

### 6.5 There is no retry

Because there is no worker, a failed send is **not** retried automatically. If a
batch was lost, it has to be re-triggered by the originating action or sent
manually.

---

## 7. Runbook: clients getting HTTP 429

**Symptom:** the MCP endpoint or an API consumer reports rate limiting.

Rate limiting exists in exactly one place: `src/lib/rate-limit.ts`, guarding the
MCP JSON-RPC endpoint (`/api/mcp`), at **30 requests per rolling minute per
caller** via Upstash.

```bash
vercel env ls production | grep -E 'UPSTASH_REDIS_REST|KV_REST_API'
```

Both naming pairs are accepted: `UPSTASH_REDIS_REST_URL`/`_TOKEN` and the
Vercel Marketplace integration's `KV_REST_API_URL`/`KV_REST_API_TOKEN`.

**If neither pair is set, the code falls back to a weak in-memory limiter** and
logs `[rate-limit] No Upstash Redis credentials found`. On serverless that means
per-instance limits — effectively no shared limit. Look for that warning in the
logs; it is the real failure mode, not the 429 itself.

To change the budget, edit `REQUESTS_PER_WINDOW` / `WINDOW` in
`src/lib/rate-limit.ts` and deploy. There is no runtime knob.

---

## 8. Runbook: the alerting job itself

`/api/cron/alert-check` is the only Vercel cron. It:

1. Authenticates the caller with `CRON_SECRET` — either
   `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) or
   `?secret=<CRON_SECRET>` (fallback for uptime monitors that cannot send
   custom headers). Anything else is 401.
2. Re-runs the Supabase connectivity check and `get_cron_health()`.
3. POSTs a message to `ALERT_WEBHOOK_URL` if there are problems. The payload
   carries both `text` and `content` so one implementation works for Slack or
   Discord.
4. Returns 200 normally; **503 only when there were problems and the webhook
   POST also failed**.

Exercise it by hand (export the secret in your shell; never paste it into a
file):

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://task.conto.ec/api/cron/alert-check | jq
# {"ok":true,"problems":[],"alerted":false,"timestamp":"..."}
```

Verify the schedule in the Vercel dashboard → Project → Cron Jobs; it must show
one entry, `/api/cron/alert-check`, `0 8 * * *`.

**Known gap:** daily alerting means up to ~24h detection latency for a broken
hourly job, and if `ALERT_WEBHOOK_URL` is unset the alert is only
`console.error`'d into the function logs, where nobody sees it. Mitigation, if
tighter detection is wanted: point an external uptime monitor at
`https://task.conto.ec/api/health` (any frequency — the probe is deliberately
cheap) and at
`https://task.conto.ec/api/cron/alert-check?secret=<CRON_SECRET>`.

---

## 9. Runbook: bad deploy — roll back

```bash
vercel ls                              # find the last known-good deployment
vercel rollback <deployment-url>       # or:
vercel deploy --prod                   # redeploy a known-good commit
```

The project deploys directly from `main` (`vercel deploy --prod`). Remember env
vars are baked in at build time: changing one requires a redeploy.

After rolling back, run the §2 triage. If the bad deploy also applied
migrations, database rollback is **not** automatic — see
`ops/4-backup-disaster-recovery.md`.

---

## 10. Escalation and communication

| Situation | Action |
|---|---|
| Site down > 15 min | Notify stakeholders; work §3, then §9 |
| Data loss suspected | **Stop writing.** Go to `ops/4-backup-disaster-recovery.md` §7.1 before any repair attempt |
| Credential compromise | `ops/4-backup-disaster-recovery.md` §7.4 (rotate, then redeploy) |
| Supabase or Vercel account inaccessible | `ops/4-backup-disaster-recovery.md` §7.2/§7.3 and [`MIGRACION.md`](../MIGRACION.md) |

After any incident, record what happened and what was actually run. There is no
automated post-mortem tooling in this project.

---

## 11. References

* `src/app/api/health/route.ts` — what `/api/health` really checks
* `src/app/api/health/cron/route.ts` — what `/api/health/cron` really checks
* `src/app/api/cron/alert-check/route.ts` — the alerting job and its auth
* `src/lib/cron-jobs.ts` — the 7 monitored pg_cron jobs
* `src/lib/notifications/notify.ts` — synchronous notification path
* `src/lib/rate-limit.ts` — the only rate limiter
* `vercel.json` — the single Vercel cron
* `.env.example` — authoritative list of environment variable names
* `ops/4-backup-disaster-recovery.md` — backup/restore
* `ops/5-troubleshooting-guide.md` — symptom-first troubleshooting
* `ops/7-error-tracking-config.md` — Sentry and logging, as configured
* [`MIGRACION.md`](../MIGRACION.md) — moving the project to different accounts

---

**Last verified against the codebase and production:** 2026-09-10
