# Troubleshooting Guide — TaskFlow

**Status:** verified against this repository and against production on 2026-09-10.
**Scope:** TaskFlow Kanban (Next.js 16 on Vercel + Supabase). This replaces an
earlier version that troubleshot a BullMQ queue, a `redis-cli`-reachable Redis,
Gmail API service accounts and Vercel KV as a job store. None of those exist in
this project — the commands in that version could not be run.

Symptom-first. For incident procedures (roll back, restore, escalate) see
`ops/3-runbooks.md`; for backup/restore see `ops/4-backup-disaster-recovery.md`.

> **Migration note:** account-bound values below (`task.conto.ec`, Supabase ref
> `txdyijyswpsalqnwfopc`, Vercel IDs) belong to the **current** accounts. Moving
> the project: [`MIGRACION.md`](../MIGRACION.md).

---

## 0. Start here — the three probes

```bash
curl -s https://task.conto.ec/api/health | jq
curl -s https://task.conto.ec/api/health/cron | jq
curl -s -o /dev/null -w '%{http_code}\n' https://task.conto.ec/
```

`/api/health` = "can the app reach Supabase" (one anon `select` on the public
`permissions` catalog).
`/api/health/cron` = "are the 7 pg_cron jobs fresh" (via the
`get_cron_health()` RPC).
Neither endpoint requires a secret, and both are safe to poll.

Where the logs are:

```bash
vercel ls                       # deployments
vercel logs <deployment-url>    # function logs — the app's stdout/stderr
```

Supabase dashboard → project `txdyijyswpsalqnwfopc` → **Logs** (API, Postgres,
Auth) and **SQL Editor** for everything database-side. There is no operator
`psql` shell and no `redis-cli` host.

---

## 1. Users can't load the app

| Check | Command | Meaning |
|---|---|---|
| App + DB | `curl -s https://task.conto.ec/api/health \| jq` | 503 → Supabase side; no JSON → deploy/function side |
| Deployment | `vercel ls` | latest production build should be READY |
| Errors | `vercel logs <url>` | actual stack traces |
| Env names | `vercel env ls production` | compare to `.env.example` |

Most frequent real causes:

1. **A bad deploy.** Roll back: `ops/3-runbooks.md` §9.
2. **Missing env var after an env change.** Env vars are baked in at **build**
   time — after adding one you must redeploy, not restart.
3. **Supabase project paused or unreachable.** Check the dashboard.
4. **Domain/DNS.** `curl -sI https://task.conto.ec` — a certificate or DNS error
   points at Vercel domain settings or the registrar, not at the code.

---

## 2. A user says "I don't have permission" (or a mutation silently does nothing)

**Read this before opening a bug.** `org_role` and RBAC are two separate systems
in this project:

* `organization_members.org_role` ∈ {owner, admin, member, guest} does **not**
  by itself grant `task.create`, `task.update`, etc.
* Granular permissions come from `role_assignments` (one row **per board**,
  `role_id` → `roles` → `role_permissions`). The RLS policies for content
  mutations check `role_assignments`, **not** `org_role`. The system role
  "Contribuyente" is what grants `task.create` / `task.update`.

```sql
-- What a user can actually do, per board:
select ra.board_id, r.name as role, rp.permission_id
from role_assignments ra
join roles r on r.id = ra.role_id
left join role_permissions rp on rp.role_id = r.id
where ra.user_id = '<uuid>'
order by ra.board_id;

-- Which organizations the user belongs to (a user can be in several):
select organization_id, org_role from organization_members where user_id = '<uuid>';
```

Two RLS behaviours that look exactly like bugs:

* **Editing another user's profile appears to succeed but changes nothing.**
  `profiles_update_own` limits UPDATE to `id = auth.uid()`, so with the normal
  client an owner's edit of someone else's name affects **0 rows and raises no
  error**. That flow must use a service-role client.
* **Changing another member's `org_role` does work** with the normal client —
  `org_members_update` allows it for an owner. So if that fails, it is a real
  bug, not RLS by design.

Also: `organization_members` is `UNIQUE(organization_id, user_id)`. A membership
query filtered only by `user_id` can return the wrong organization's row.

---

## 3. Emails are not being sent

There is **no queue and no worker**. `src/lib/notifications/notify.ts` sends
synchronously in the request that triggered it. The wired events
(`task_mentioned`, `status_changed`) are fired by **Postgres triggers** calling
`/api/internal/notify-event` via `net.http_post`, gated by
`INTERNAL_NOTIFY_SECRET`.

Work the chain in order:

```sql
-- 1. Did the send fail and get recorded?
select * from public.failed_jobs order by created_at desc limit 20;

-- 2. Was the in-app notification created at all?
select id, user_id, type, created_at from public.notifications
where user_id = '<uuid>' order by created_at desc limit 20;

-- 3. Did the user opt out?
select * from public.notification_preferences where user_id = '<uuid>';
```

| Finding | Cause |
|---|---|
| Row in `failed_jobs` | Send attempted and failed — read the message; usually Resend auth/domain |
| Notification row, no email | Preferences, or Resend rejected/bounced it |
| No notification row at all | Trigger didn't fire, or `/api/internal/notify-event` rejected the payload — check `vercel logs` for that route and that `INTERNAL_NOTIFY_SECRET` is set |
| Nothing anywhere | The event type may simply not be wired yet: only `task_mentioned` and `status_changed` are |

Then check Resend: `RESEND_API_KEY` valid, the domain of
`NOTIFICATION_FROM_EMAIL` still verified, message status delivered/bounced/spam.

**Failed sends are never retried automatically.** If delivery was lost, it must
be re-triggered.

---

## 4. Scheduled work didn't happen

Distinguish the two systems first (`ops/3-runbooks.md` §0.1). Recurring tasks,
due-soon notifications, automations, the audit purge and metrics snapshots are
**pg_cron**, not Vercel cron. Vercel cron has exactly one job, and it only
alerts.

```bash
curl -s https://task.conto.ec/api/health/cron | jq '.jobs[] | select(.isStale or .lastStatus=="failed")'
```

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;

select status, return_message, start_time
from cron.job_run_details
where command like '%<job_name>%'
order by start_time desc limit 20;
```

| Finding | Fix |
|---|---|
| Job absent from `cron.job` | A migration that calls `cron.schedule(...)` wasn't applied → `supabase db push`. Never schedule it by hand |
| `return_message` shows a Postgres error | Fix the function in a **new migration file** (project rule: no loose SQL) |
| Job runs but isn't in the health output | It's unmonitored — add it to `src/lib/cron-jobs.ts` **and** to `monitored_jobs` in `get_cron_health()` |
| Everything stale right after a restore/deploy | Expected. Hourly jobs recover within the hour; daily ones at ~03:00 / 03:10 UTC |

---

## 5. HTTP 429 / rate limiting

Only one rate limiter exists: `src/lib/rate-limit.ts`, protecting the MCP
JSON-RPC endpoint `/api/mcp` at **30 requests per rolling minute per caller**
(Upstash sliding window, key prefix `taskflow-mcp`).

```bash
vercel env ls production | grep -E 'UPSTASH_REDIS_REST|KV_REST_API'
vercel logs <deployment-url> | grep '\[rate-limit\]'
```

Either naming pair works: `UPSTASH_REDIS_REST_URL`/`_TOKEN`, or
`KV_REST_API_URL`/`KV_REST_API_TOKEN` (what the Vercel Marketplace "Upstash for
Redis" integration provisions). With **neither**, the code logs
`[rate-limit] No Upstash Redis credentials found` and degrades to a per-instance
in-memory limiter — on serverless that is effectively no shared limit. That
warning is the real problem to chase; a legitimate 429 is the limiter working.

Changing the budget means editing the constants and deploying.

---

## 6. Task import fails or imports partially

Feature: `/admin/importar-tareas` (organization **owner** only) →
`POST /api/admin/import-tasks`; template at
`GET /api/admin/import-tasks/template`.

Facts that resolve most reports:

* Accepted: `.xlsx`, `.xls`, `.csv`; **max 500 rows**.
* Headers are the shared constant `IMPORT_HEADERS` in
  `src/lib/import/task-row.ts`: Título, Estado, Prioridad, Asignado, Etiqueta,
  Fecha inicio, Fecha vencimiento. Downloading the template is the reliable fix
  for header complaints.
* **Partial import is intended behaviour**: valid rows are created and invalid
  ones reported by row number, where row 1 is the first *data* row (the header
  is not counted). "It only imported some" is usually not a bug — read the
  reported rows.
* CSV encoding is handled two ways on purpose: with a UTF-8 BOM, SheetJS
  detects the encoding natively; without a BOM, codepage 65001 is forced. Both
  paths have regression tests. Mojibake in the *source file* is still garbage in.
* Non-owners get denied — that is `org_role`-gated, unlike content mutations
  (§2).

Note for dependency work: `xlsx` is installed from the **SheetJS CDN**
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), not from the npm
registry, because the registry build has two unpatched HIGH vulnerabilities.
Do not "fix" this by switching to `xlsx: ^0.18.5`.

---

## 7. Google integrations (Drive / Calendar / Gmail) fail

These are optional and all funnel through
`/api/integrations/google/connect` → `/api/integrations/google/callback`.

```bash
vercel env ls production | grep -i google
```

Required names: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`, plus the browser-side
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`.

Usual causes: `GOOGLE_OAUTH_REDIRECT_URI` doesn't exactly match the authorized
redirect URI in Google Cloud Console (a very common failure right after a domain
change — see [`MIGRACION.md`](../MIGRACION.md)); the Picker key's HTTP-referrer
restriction doesn't include the current domain; or the required APIs (Calendar,
Drive, Gmail) aren't enabled on the Google Cloud project.

---

## 8. Local development problems

```bash
npm ci
npx tsc --noEmit         # type check (there is no dedicated npm script)
npm run lint
npm test                 # 15 suites / 215 tests, all green as of 2026-09-09
npm run dev
```

* Missing `.env.local` → the app throws
  `NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY must be set`. Copy
  `.env.example` and fill it in; never commit it.
* Stale types after a schema change → regenerate `src/lib/supabase/database.types.ts`.
  Some RPCs (`get_cron_health`) are deliberately called through an untyped
  client because they are not in the generated types.
* Schema drift → `supabase link --project-ref txdyijyswpsalqnwfopc`, then
  `supabase db push`. Schema changes only via versioned files in
  `supabase/migrations/` (114 files).

---

## 9. When the answer is "no data"

Before assuming an outage, check whether the observation is simply an empty
result under RLS. Anon/other-tenant reads on tenant-scoped tables
(`organizations`, `boards`, `tasks`, …) return empty or raise
`permission denied for function is_org_member` rather than an obvious error.
That is why `/api/health` probes the global `permissions` catalog instead of any
tenant table — an anon read of a tenant table would report "down" even on a
perfectly healthy system.

---

## 10. Escalation

| Situation | Go to |
|---|---|
| Site down | `ops/3-runbooks.md` §3, then §9 (roll back) |
| Cron stale | `ops/3-runbooks.md` §4 |
| Suspected data loss | **Stop writing.** `ops/4-backup-disaster-recovery.md` §7.1 |
| Leaked credential | `ops/4-backup-disaster-recovery.md` §7.4 |
| Account/domain move | [`MIGRACION.md`](../MIGRACION.md) |

---

## 11. References

* `src/app/api/health/route.ts`, `src/app/api/health/cron/route.ts`
* `src/app/api/cron/alert-check/route.ts`
* `src/lib/cron-jobs.ts`, `src/lib/notifications/notify.ts`, `src/lib/rate-limit.ts`
* `src/lib/import/task-row.ts`
* `.env.example` — authoritative environment variable names
* `ops/3-runbooks.md`, `ops/4-backup-disaster-recovery.md`, `ops/7-error-tracking-config.md`

---

**Last verified against the codebase and production:** 2026-09-10
