# Monitoring Guide — TaskFlow

> ## ⚠️ Reference guide — the dashboard stack described here is NOT deployed
>
> This project runs **no Grafana, no Prometheus, no Datadog and no metrics
> agent**. `config/grafana/` and `config/prometheus/` contain example
> provisioning files only; `docker-compose.grafana.yml` has never been part of
> the deployment, `config/grafana/dashboards/` (the directory it mounts as the
> dashboard source) **does not exist**, and the Prometheus config scrapes
> `localhost` exporters that nobody runs. `ops/8-performance-monitoring.sh` is
> likewise not executable here — it needs `psql` and `redis-cli` against hosts
> this project does not have. Nothing in this file is a description of a live
> system; it is reference material for someone who decides to build one.
>
> **What is actually monitored today is in `ops/HEALTH_CHECK_GUIDE.md`.**

**Status:** rewritten 2026-09-10 to stop describing a monitoring platform that
does not exist. The previous version documented continuous monitoring loops,
alert handlers and Prometheus/Datadog exporters as if they were running.

> **Migration note:** `task.conto.ec`, Supabase ref `txdyijyswpsalqnwfopc` and
> the Vercel project IDs belong to the **current** accounts. See
> [`MIGRACION.md`](../MIGRACION.md).

---

## 1. What monitoring really exists

| Layer | Tool | Deployed? |
|---|---|---|
| Liveness + Supabase connectivity | `GET /api/health` | **Yes** |
| pg_cron freshness (7 jobs) | `GET /api/health/cron` | **Yes** |
| Daily alerting to a webhook | `GET /api/cron/alert-check`, Vercel Cron `0 8 * * *` | **Yes** |
| Errors and 10%-sampled traces | Sentry (`@sentry/nextjs`) | Yes, if the DSN env vars are set |
| Function logs, invocation counts, bandwidth | Vercel dashboard / `vercel logs` | Yes (platform-provided) |
| Postgres metrics, slow queries, API logs | Supabase dashboard | Yes (platform-provided) |
| Product metrics (throughput, cycle time…) | `/dashboard`, `/admin/reportes`, `metrics_snapshots` table | Yes, in-app |
| Grafana / Prometheus dashboards | `config/`, `docker-compose.grafana.yml` | **No — example config only** |
| Shell metric collectors | `ops/8-performance-monitoring.sh` | **No — not executable here** |
| Datadog / CloudWatch / PagerDuty | — | **No — never wired** |

`ops/1-monitoring-alerts.yaml` and `ops/6-metrics-dashboard.json` are in the
same category: they define KPIs and dashboard tiles for a "TaskFlow Notification
System" with Datadog queries (`avg:taskflow.email.delivery_time{env:prod}`) and
a BullMQ queue. **No system reads those files.** Treat them as design sketches.

---

## 2. Day-to-day monitoring, as actually practised

```bash
# The two probes (see ops/HEALTH_CHECK_GUIDE.md for response shapes)
curl -s https://task.conto.ec/api/health | jq
curl -s https://task.conto.ec/api/health/cron | jq

# Logs and deployments
vercel ls
vercel logs <deployment-url>
```

Supabase dashboard → project `txdyijyswpsalqnwfopc` → Reports / Logs for
database CPU, connections, slow queries and API errors. Sentry (if configured)
for the error stream — remembering that the browser SDK loads lazily and
`tracesSampleRate` is `0.1` (`ops/7-error-tracking-config.md` §2.1).

In-app product metrics come from the `metrics_snapshots` table, written daily by
the `record-daily-metrics-snapshots` pg_cron job and surfaced in `/dashboard`
and `/admin/reportes`. If that job goes stale, report history develops gaps —
that is a monitoring failure the health endpoint does catch.

---

## 3. The real gaps

Stated plainly so nobody assumes coverage that isn't there:

1. **Alerting runs once a day.** A broken hourly pg_cron job can go unnoticed
   for ~24 hours.
2. **No alert on error-rate or latency.** Sentry does not feed the webhook; a
   spike of 500s produces no notification.
3. **No uptime monitor between cron runs** unless one is configured externally.
4. **No historical latency series.** `/api/health` returns a `latencyMs` per
   call but nothing stores it.
5. **With `ALERT_WEBHOOK_URL` unset,** alerts only reach the function logs.

Cheapest fixes, in order, requiring no new code: point an external uptime
monitor at `/api/health` (1–5 min), `/` (5 min), `/api/health/cron` (15–60 min)
and `/api/cron/alert-check?secret=<CRON_SECRET>` (hourly); set
`ALERT_WEBHOOK_URL`; enable Sentry alert rules in the Sentry UI.

---

## 4. If you do decide to build a dashboard stack

Read this section as a starting point, not as instructions for something
already running.

* `docker-compose.grafana.yml` brings up Postgres 16, Grafana 11 (host port
  3001) and Prometheus (9090). **Before it can work** you must create
  `config/grafana/dashboards/` — the compose file mounts it and it does not
  exist — and provide the `POSTGRES_*` / `GRAFANA_ADMIN_*` variables the
  provisioning files interpolate. None of those names are in `.env.example`,
  because the app does not use them.
* `config/grafana/provisioning/datasources/postgres.yml` points at a local
  `postgres` container with `sslmode: disable`. Production data lives in
  **Supabase**, which requires TLS and a real connection string — that file
  would have to be rewritten, and pointing Grafana at production means handing
  it database credentials. Treat that as a security decision, not a config edit.
* `config/prometheus/prometheus.yml` scrapes `localhost:9100` (node_exporter),
  `localhost:9187` (postgres_exporter) and `localhost:3000`. None of those
  exporters exist, and the app on Vercel exposes no `/metrics` endpoint. There
  is nothing to scrape until something is instrumented.
* A more proportionate alternative for a serverless app: use the platform
  dashboards (Vercel + Supabase + Sentry) and add uptime monitoring, rather than
  operating a metrics stack for one Next.js project.

---

## 5. References

* `ops/HEALTH_CHECK_GUIDE.md` — what is genuinely monitored, with commands
* `ops/7-error-tracking-config.md` — Sentry and logging, as configured
* `ops/THRESHOLDS_EXPLAINED.md` / `ops/THRESHOLDS_VALIDATION.md` — threshold
  reference material (also not wired to anything)
* `ops/3-runbooks.md` — what to do when a check fails
* `src/lib/cron-jobs.ts` — the 7 monitored pg_cron jobs
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against the repository:** 2026-09-10
