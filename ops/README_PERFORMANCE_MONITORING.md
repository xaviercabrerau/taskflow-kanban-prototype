# Performance Monitoring — TaskFlow

> ## ⚠️ Reference guide — not deployed
>
> There is **no performance-monitoring system running** in this project.
> `ops/8-performance-monitoring.sh` — the script this document was written
> around — cannot run here: it needs `psql` against a self-hosted Postgres,
> `redis-cli` against a Redis host, a `GMAIL_ACCESS_TOKEN`, and env vars
> (`REDIS_HOST`, `DB_HOST`, `SUPABASE_PROJECT_ID`, `SUPABASE_API_KEY`) that this
> project does not define. `psql`, `redis-cli` and `gcloud` are not installed.
> Nothing writes `monitoring-logs/`, `metrics/` or `alerts.log`, and no cron or
> systemd unit invokes any of it.
>
> **What actually runs is in `ops/HEALTH_CHECK_GUIDE.md`.**

**Status:** rewritten 2026-09-10. The previous version was a delivery summary
describing 8 monitoring sections, continuous loops, Prometheus exporters and
production systemd deployment as though they were live.

> **Migration note:** `task.conto.ec`, Supabase ref `txdyijyswpsalqnwfopc` and
> the Vercel project IDs belong to the **current** accounts. See
> [`MIGRACION.md`](../MIGRACION.md).

---

## 1. Where performance data actually comes from today

| Signal | Source | How to read it |
|---|---|---|
| Supabase round-trip latency, per call | `/api/health` → `checks.supabase.latencyMs` | `curl -s https://task.conto.ec/api/health \| jq '.checks.supabase.latencyMs'` — **not stored anywhere** |
| Function duration, invocations, errors, bandwidth | Vercel dashboard → Project → Observability | Platform-provided; no setup |
| Slow queries, connections, DB CPU/IO | Supabase dashboard → project `txdyijyswpsalqnwfopc` → Reports / Query Performance | Platform-provided |
| Transaction traces (10% sample) | Sentry, if `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set | `tracesSampleRate: 0.1` |
| Client bundle weight | `npm run build` output | Sentry's browser SDK (~143 KB gzip) is deliberately lazy-loaded, see `instrumentation-client.ts` |
| Product throughput/cycle-time | `metrics_snapshots` table, written daily by pg_cron | `/dashboard`, `/admin/reportes` |

That is the complete list. There is no APM agent, no custom `/metrics`
endpoint, no synthetic load testing, and no historical latency series.

---

## 2. Measuring something, right now

```bash
# End-to-end latency of the health probe (repeat a few times; the first call
# after idle includes serverless cold start)
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w 'total=%{time_total}s connect=%{time_connect}s\n' \
    https://task.conto.ec/api/health
done

# The app's own view of Supabase latency
curl -s https://task.conto.ec/api/health | jq '.checks.supabase.latencyMs'

# Page response
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' https://task.conto.ec/
```

Local build/test performance:

```bash
npm run build          # bundle sizes per route
npm test               # 15 suites / 215 tests
npx tsc --noEmit
```

Slow queries are best investigated in the Supabase dashboard's Query
Performance view, and slow pages in Vercel's per-function duration charts —
both give more than a shell script could.

---

## 3. Interpreting what you see

* **Cold starts are real.** A first `/api/health` after idle can be several
  hundred ms slower than the next one. Measure repeatedly before concluding
  anything.
* **`latencyMs` is one anon `select` against the `permissions` catalog.** It
  measures reachability, not application query performance.
* **Sentry's 10% sampling** makes small-sample latency claims unreliable.
* **Rate limiting is not a performance feature.** `/api/mcp` allows 30
  requests/minute per caller; a 429 there is policy, not saturation
  (`src/lib/rate-limit.ts`).

---

## 4. If you want real performance monitoring

Proportionate options for a serverless Next.js + Supabase app, roughly in order
of effort:

1. Turn on Vercel's Speed Insights / Web Analytics for field Core Web Vitals.
2. Raise `tracesSampleRate` in the Sentry configs (cost/quota tradeoff) and add
   `withSentryConfig` in `next.config.ts` so traces carry usable source maps
   (`ops/7-error-tracking-config.md` §2.1).
3. Have an external uptime monitor record response times for `/api/health` and
   `/` — that gives the historical series nothing currently stores.
4. Use Supabase's Query Performance view rather than building query collectors.
5. Only then consider a metrics stack — and note the caveats in
   `ops/MONITORING_GUIDE.md` §4 (the Grafana/Prometheus example config is
   incomplete and points at localhost exporters that do not exist).

Do not resurrect `ops/8-performance-monitoring.sh` as-is; the system it was
written for (self-hosted Postgres, Redis, BullMQ, Gmail API) is not this system.

---

## 5. References

* `ops/HEALTH_CHECK_GUIDE.md` — the checks that actually run
* `ops/MONITORING_GUIDE.md` — full picture of what is and isn't monitored
* `ops/THRESHOLDS_EXPLAINED.md` — what the numbers would mean, if collected
* `ops/7-error-tracking-config.md` — Sentry configuration and its limits
* `instrumentation-client.ts` — the lazy Sentry load and its accepted tradeoff
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against the repository:** 2026-09-10
