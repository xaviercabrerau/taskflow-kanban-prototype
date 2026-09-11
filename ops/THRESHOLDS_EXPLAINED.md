# Thresholds Explained — TaskFlow

> ## ⚠️ Reference guide — these thresholds are not enforced by anything
>
> No system in this project evaluates a threshold. There is no metrics
> collector, no Grafana/Prometheus/Datadog, and no alert rule engine. The one
> automated alert (`/api/cron/alert-check`, daily) fires on **boolean**
> conditions only — "Supabase unreachable" and "a pg_cron job is stale or
> failed" — never on a latency or error-rate number. The numeric thresholds
> defined in `ops/1-monitoring-alerts.yaml` and `ops/6-metrics-dashboard.json`
> are read by nothing.
>
> This document exists so that whoever wires up real alerting has reasoned
> starting values instead of invented ones. **It is not a description of
> current alerting behaviour.**

**Status:** rewritten 2026-09-10. The previous version explained thresholds for
email queue depth, BullMQ job success rate, Redis ping latency and Gmail API
availability — metrics belonging to a queue-and-worker architecture this project
does not have (notifications are sent synchronously; see
`src/lib/notifications/notify.ts`).

> **Migration note:** `task.conto.ec` and Supabase ref `txdyijyswpsalqnwfopc`
> belong to the **current** accounts. See [`MIGRACION.md`](../MIGRACION.md).

---

## 1. The only thresholds that are actually enforced

Both are binary, and both live in code, not in config:

| Condition | Where | Effect |
|---|---|---|
| Anon `select id from permissions limit 1` returns an error, or Supabase is unreachable | `src/app/api/health/route.ts`, and re-checked in `alert-check` | `/api/health` → 503; alert-check adds a problem line |
| A monitored pg_cron job `is_stale`, or `last_status = 'failed'`, or reports nothing | `get_cron_health()` RPC + `src/lib/cron-jobs.ts` | `/api/health/cron` → 503 `degraded`; alert-check adds a problem line |

"Stale" is defined **inside the `get_cron_health()` RPC** relative to each job's
expected interval, not in application code. To change staleness tolerance you
change that function — via a new migration file, never loose SQL.

One more real, non-alerting limit:

| Limit | Value | Where |
|---|---|---|
| MCP endpoint rate limit | 30 requests / rolling minute / caller | `REQUESTS_PER_WINDOW`, `WINDOW` in `src/lib/rate-limit.ts` |

Exceeding it returns 429. It is a policy limit, not a health threshold, and
changing it requires an edit and a deploy.

---

## 2. Suggested thresholds, if alerting is ever built

Applicable to **this** architecture (Next.js serverless + Supabase + Resend +
Upstash), replacing the queue-era table. Values are starting points to be tuned
against real data, not measured SLOs — see §4.

### 2.1 Availability

| Metric | Target | Warning | Critical | Rationale |
|---|---|---|---|---|
| `/api/health` HTTP 200 rate | 99.9% | < 99.9% over 1h | 2 consecutive failures | The probe is a single indexed read; sustained failure means Supabase or the deployment is down |
| `/` HTTP 200 rate | 99.9% | < 99.9% over 1h | 2 consecutive failures | Distinguishes "site down" from "database down" |

Two consecutive failures rather than one absorbs a transient cold-start or
network blip without hiding a real outage for long.

### 2.2 Latency

| Metric | Target | Warning | Critical | Rationale |
|---|---|---|---|---|
| `/api/health` `checks.supabase.latencyMs` | < 300 ms | > 800 ms sustained 15 min | > 2000 ms sustained 5 min | Measured ~750 ms on a cold production call (2026-09-10); warm calls are far lower, so alert on *sustained* values only |
| `/api/health` total response time | < 1 s | > 2 s | > 5 s | Includes serverless cold start |
| Page TTFB (`/`) | < 800 ms | > 1.5 s | > 3 s | Field data would come from Vercel Speed Insights, not from a probe |

**Cold starts are the dominant noise source.** Any single-sample latency alert
on a serverless app will page on cold starts. Always require a sustained window.

### 2.3 pg_cron freshness

Do not invent numbers here — the expected intervals are declared in
`src/lib/cron-jobs.ts` and enforced by the RPC:

| Job | Expected | Reasonable stale point |
|---|---|---|
| `taskflow_check_due_soon_tasks` | hourly | > 2 h |
| `taskflow_execute_due_date_automations` | hourly | > 2 h |
| `taskflow_execute_sla_automations` | hourly | > 2 h |
| `taskflow_execute_recurring_tasks` | hourly | > 2 h |
| `purge-expired-audit-logs` | daily (~03:00 UTC) | > 36 h |
| `record-daily-metrics-snapshots` | daily (~03:10 UTC) | > 36 h |
| `taskflow_resolve_crm_sync_responses` | every minute | > 15 min |

One missed cycle is common (a job that runs at :00 and is checked at :01 has a
legitimately old timestamp); two missed cycles is a signal. A freshly restored
database is stale by definition until each job runs once — that is why a
restore drill should not page anyone.

### 2.4 Errors

| Metric | Target | Warning | Critical | Rationale |
|---|---|---|---|---|
| HTTP 5xx rate | 0% | > 0.5% over 15 min | > 2% over 5 min | Would need Vercel or Sentry as the source; nothing computes it today |
| New Sentry issue in production | — | any | — | Cheapest useful alert, configurable in the Sentry UI with no code |
| Rows added to `public.failed_jobs` | 0 | > 5 / hour | > 20 / hour | Every row is an email that was **not** retried — there is no retry worker |

### 2.5 Rate limiting

| Metric | Warning | Rationale |
|---|---|---|
| `[rate-limit] No Upstash Redis credentials found` in logs | any occurrence | Rate limiting has silently degraded to a per-instance in-memory limiter — effectively no shared limit on serverless. This matters more than the 429s themselves |
| 429 rate on `/api/mcp` | sustained > 0 for one caller | Either a misbehaving client or a budget that is genuinely too small |

---

## 3. Metrics deliberately dropped from this document

They described a system that does not exist here:

* **Email delivery time / queue depth / job success rate** — there is no queue
  and no worker. Sending is synchronous inside the triggering request; failures
  land in `failed_jobs` and are not retried.
* **Redis ping latency** — Upstash is a REST-based rate limiter, not a data path
  in the request cycle. There is no `redis-cli` host to ping.
* **Gmail API availability** — email goes through Resend. Google APIs are used
  only for optional Drive/Calendar/Gmail *integrations*, not for notification
  delivery.

---

## 4. How to change a threshold responsibly

1. **Measure first.** Nothing here was derived from a production time series,
   because none is collected. Gather at least two weeks of data before treating
   any number above as a commitment.
2. **Change it where it actually lives**: staleness in the `get_cron_health()`
   migration; the rate limit in `src/lib/rate-limit.ts`; anything else in
   whichever monitor you introduce. Editing `ops/1-monitoring-alerts.yaml` or
   `ops/6-metrics-dashboard.json` changes nothing — no code reads them.
3. **Record why**, in the same commit.
4. **Prefer sustained-window conditions** over instantaneous ones on serverless.
5. **Re-check the false-positive cases** listed in
   `ops/HEALTH_CHECK_GUIDE.md` §4.2 before making an alert stricter.

---

## 5. References

* `ops/THRESHOLDS_VALIDATION.md` — companion document: how these numbers were
  (and were not) validated
* `ops/HEALTH_CHECK_GUIDE.md` — the checks that actually run
* `ops/MONITORING_GUIDE.md` — what is and isn't monitored
* `src/lib/cron-jobs.ts`, `src/lib/rate-limit.ts`
* `src/app/api/health/route.ts`, `src/app/api/health/cron/route.ts`,
  `src/app/api/cron/alert-check/route.ts`
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against the repository:** 2026-09-10
