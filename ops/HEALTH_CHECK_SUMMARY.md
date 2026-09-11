# Health Check Summary — TaskFlow

**Status:** one-page summary of `ops/HEALTH_CHECK_GUIDE.md`, verified against
production on 2026-09-10. This replaces an earlier "deliverable status /
implementation checklist" summary that described a shell-script health checker
for Redis, BullMQ, Gmail API and Google Cloud Pub/Sub — components this project
does not have.

> **Migration note:** `task.conto.ec` and Supabase ref `txdyijyswpsalqnwfopc`
> belong to the **current** accounts. See [`MIGRACION.md`](../MIGRACION.md).

---

## The three commands

```bash
curl -s https://task.conto.ec/api/health | jq
curl -s https://task.conto.ec/api/health/cron | jq
curl -s -H "Authorization: Bearer $CRON_SECRET" https://task.conto.ec/api/cron/alert-check | jq
```

---

## What each one covers

| Endpoint | Checks | Healthy | Unhealthy |
|---|---|---|---|
| `/api/health` | Anon `select id from permissions limit 1` against Supabase, with latency | 200, `{"status":"ok","checks":{"supabase":{"ok":true,"latencyMs":…}},"timestamp":…}` | 503, `"status":"error"` + `message` |
| `/api/health/cron` | `get_cron_health()` RPC → freshness of the 7 pg_cron jobs | 200, `"status":"ok"` + `jobs[]` | 503, `"status":"degraded"` (stale/failed) or `"error"` |
| `/api/cron/alert-check` | Both of the above, then POSTs `ALERT_WEBHOOK_URL` | 200, `{"ok":true,"problems":[],"alerted":false}` | 503 **only** if there were problems *and* the webhook POST failed |

Auth: the first two need none. The third requires `CRON_SECRET`, as a bearer
token or as `?secret=`.

---

## Coverage — and its limits

Covered: Next.js is serving; Postgres answers; the 7 pg_cron jobs are running.

**Not covered by any automated check:** Resend/email delivery, Upstash
(rate limiting), Google integrations, Sentry ingestion, auth/login flow, storage
bucket access, per-endpoint latency.

---

## Scheduling reality

* `vercel.json` contains **exactly one cron**: `/api/cron/alert-check` at
  `0 8 * * *` (daily, 08:00 UTC).
* The 7 recurring **data** jobs are pg_cron inside Postgres, created by
  migrations — a different system. Canonical list: `src/lib/cron-jobs.ts`.
* Consequence: with only the daily cron, a broken hourly job can go unnoticed
  for ~24 hours. Add an external uptime monitor if that matters
  (`ops/HEALTH_CHECK_GUIDE.md` §6).

---

## Expected non-incidents

* `/api/health/cron` reports `degraded` right after a restore or a fresh deploy
  until each job runs once (hourly: within the hour; daily: ~03:00/03:10 UTC).
* `/api/health` latency of several hundred ms is normal — it is a real network
  round-trip to Supabase from a cold serverless function.
* A 200 from `alert-check` with a non-empty `problems` array means the alert
  *was delivered*, not that everything is fine.

---

## Legacy scripts

`ops/2-health-check-utils.sh` and `ops/health-check-setup.sh` are **not
executable here** — they require `redis-cli` and `gcloud` (neither installed)
and probe BullMQ/Gmail/Pub/Sub components this project never had. Use the curl
commands above.

---

## References

* `ops/HEALTH_CHECK_GUIDE.md` — the full guide, with response shapes and rationale
* `ops/3-runbooks.md` §2, §4 — what to do when a probe fails
* `src/app/api/health/route.ts`, `src/app/api/health/cron/route.ts`,
  `src/app/api/cron/alert-check/route.ts`, `src/lib/cron-jobs.ts`
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against production:** 2026-09-10
