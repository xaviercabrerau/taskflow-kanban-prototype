# Health Check Guide — TaskFlow

**Status:** executable, verified against production on 2026-09-10.
This replaces an earlier version that documented `ops/2-health-check-utils.sh`
as the health-check mechanism. That script probes Redis with `redis-cli`, a
Gmail service account, Google Cloud Pub/Sub and a BullMQ queue — none of which
exist in this project — and it depends on `redis-cli` and `gcloud`, which are
not installed. **The real health checks are HTTP endpoints in the app itself.**

> **Migration note:** `task.conto.ec` and Supabase project `txdyijyswpsalqnwfopc`
> belong to the **current** accounts. Moving the project:
> [`MIGRACION.md`](../MIGRACION.md).

---

## 1. The endpoints

| Endpoint | Auth | Answers |
|---|---|---|
| `GET /api/health` | none | Is the app up and can it reach Supabase? |
| `GET /api/health/cron` | none (optional bearer forwarded) | Are the 7 pg_cron jobs fresh? |
| `GET /api/cron/alert-check` | **`CRON_SECRET`** | Both of the above, and pages `ALERT_WEBHOOK_URL` on failure |

---

## 2. Quick start

```bash
# App + Supabase connectivity
curl -s https://task.conto.ec/api/health | jq

# pg_cron freshness
curl -s https://task.conto.ec/api/health/cron | jq

# Just the status codes (for a monitor)
curl -s -o /dev/null -w '%{http_code}\n' https://task.conto.ec/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://task.conto.ec/api/health/cron
```

Locally, replace the host with `http://localhost:3000` after `npm run dev`.

---

## 3. `/api/health`

Source: `src/app/api/health/route.ts`.

**What it actually does:** creates an **anon** Supabase client and runs
`select id from permissions limit 1`, measuring latency.

Healthy response (HTTP 200) — this is the real shape, confirmed in production:

```json
{
  "status": "ok",
  "checks": { "supabase": { "ok": true, "latencyMs": 754 } },
  "timestamp": "2026-09-10T20:27:41.962Z"
}
```

Unhealthy (HTTP 503):

```json
{
  "status": "error",
  "checks": { "supabase": { "ok": false, "latencyMs": 1200, "message": "<error>" } },
  "timestamp": "..."
}
```

### 3.1 Why it probes `permissions` and not a real table

`permissions` is a global permission catalog whose `permissions_select` RLS
policy is `qual = true` — readable by anyone, including anon, because it is a
static catalog, not tenant data.

Any tenant-scoped table (`organizations`, `boards`, `tasks`, …) would be wrong
here: their RLS calls `is_org_member()` / `is_org_owner()`, and anon's EXECUTE
on those functions was deliberately revoked. An anon read now **throws**
`permission denied for function is_org_member` instead of returning an empty
array — the probe would report "down" on every request even with Supabase fully
healthy. PostgREST's own root (`/rest/v1/`) is not a substitute either: it needs
a secret API key this app never holds.

Do not "improve" this probe by pointing it at application data.

### 3.2 What it does **not** cover

No Resend check, no Upstash check, no Google API check, no pg_cron check (that
is the other endpoint), no auth-flow check. A green `/api/health` means "Next.js
is serving and Postgres answers", nothing more.

### 3.3 Safe to poll

The probe is deliberately cheap (one indexed row, anon client, no writes). Any
uptime-monitor frequency is fine.

---

## 4. `/api/health/cron`

Source: `src/app/api/health/cron/route.ts`.

**What it actually does:** calls the `get_cron_health()` SECURITY DEFINER RPC,
which reads `cron.job_run_details` inside Postgres and returns status for only
the hardcoded job names. The `cron` schema is not exposed by PostgREST and anon
cannot read it directly — the RPC is the supported path. A service-role key is
deliberately **not** used here: it would bypass every RLS policy in the project
to read a handful of rows.

Healthy response (HTTP 200):

```json
{
  "status": "ok",
  "jobs": [
    { "jobName": "purge-expired-audit-logs", "expectedInterval": "daily",
      "lastRunAt": "2026-09-10T03:00:00.090662+00:00",
      "lastStatus": "succeeded", "isStale": false }
  ],
  "timestamp": "..."
}
```

`"status"` is `"degraded"` with HTTP **503** when any job is stale or its last
status is `failed`. On RPC failure the response is `"error"` + a `hint` + the
job list with `"status":"unknown"`.

The 7 monitored jobs (`src/lib/cron-jobs.ts`, `MONITORED_JOBS`):

| Job | Expected |
|---|---|
| `taskflow_check_due_soon_tasks` | hourly |
| `taskflow_execute_due_date_automations` | hourly |
| `taskflow_execute_sla_automations` | hourly |
| `taskflow_execute_recurring_tasks` | hourly |
| `purge-expired-audit-logs` | daily (~03:00 UTC) |
| `record-daily-metrics-snapshots` | daily (~03:10 UTC) |
| `taskflow_resolve_crm_sync_responses` | every minute |

This list must stay in sync with `monitored_jobs` inside `get_cron_health()`
(`supabase/migrations/20260903200000_audit_fase_a_security_fixes.sql`). A job
present in `cron.job` but absent from both lists is invisible to monitoring —
that already happened once with `taskflow_execute_recurring_tasks`.

### 4.1 Authentication note

The handler forwards any `Authorization` header it receives, from when the RPC
was granted to `authenticated` only. A later migration
(`20260810235939_grant_cron_health_to_anon.sql`) also granted `anon`, for the
benefit of `/api/cron/alert-check`. **So this endpoint now works with no
Authorization header at all** — the forwarding is a convenience, not an access
boundary. Accepted tradeoff: the data is whether seven non-secret job names are
stale.

### 4.2 Expected false positive

A freshly restored or newly deployed database reports `degraded` until each job
has run once. Wait one cycle before escalating.

---

## 5. `/api/cron/alert-check`

Source: `src/app/api/cron/alert-check/route.ts`. Scheduled by `vercel.json` —
**the only Vercel cron in the project** — at `0 8 * * *` (daily, 08:00 UTC).

Auth: `Authorization: Bearer <CRON_SECRET>`, or `?secret=<CRON_SECRET>` when the
header is absent. The query-param fallback exists because many free-tier uptime
monitors cannot send custom headers. Anything else → 401.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://task.conto.ec/api/cron/alert-check | jq
# {"ok":true,"problems":[],"alerted":false,"timestamp":"..."}
```

It returns 200 normally and **503 only when there were problems and the webhook
POST also failed**. So a 200 does not by itself mean "healthy" — read
`problems`.

---

## 6. Wiring an external monitor

Nothing else in the project watches these endpoints between the daily cron runs.
Minimum useful setup, no new code required:

| Target | Frequency | Alert when |
|---|---|---|
| `https://task.conto.ec/api/health` | 1–5 min | status ≠ 200 |
| `https://task.conto.ec/` | 5 min | status ≠ 200 |
| `https://task.conto.ec/api/health/cron` | 15–60 min | status ≠ 200 |
| `https://task.conto.ec/api/cron/alert-check?secret=<CRON_SECRET>` | hourly | status ≠ 200 |

Put the secret in the monitor's own secret storage. Never in a repo, a
dashboard description or this file.

---

## 7. About `ops/2-health-check-utils.sh` and `ops/health-check-setup.sh`

Both are **legacy and not executable in this environment.** They assume
`redis-cli`, `gcloud`, a BullMQ queue and a Gmail service account, and they read
env vars (`REDIS_URL`, `GMAIL_SERVICE_ACCOUNT`, `PUBSUB_TOPIC`,
`BULLMQ_QUEUE_NAME`) that this project does not define. They are kept only as
historical artifacts. **Use the curl commands above instead.** If a shell
wrapper is ever wanted, it should be rewritten around these three endpoints.

---

## 8. References

* `src/app/api/health/route.ts`, `src/app/api/health/cron/route.ts`
* `src/app/api/cron/alert-check/route.ts`
* `src/lib/cron-jobs.ts`
* `vercel.json`
* `ops/HEALTH_CHECK_SUMMARY.md` — one-page summary of this guide
* `ops/3-runbooks.md` §2 (triage), §4 (cron stale)
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against production:** 2026-09-10
