# Thresholds Validation — TaskFlow

> ## ⚠️ Reference guide — no thresholds have been validated against production data
>
> The honest state of this project: **no metrics time series is collected**, so
> there is nothing to validate thresholds against. There is no
> Grafana/Prometheus/Datadog, no APM beyond Sentry's 10% trace sampling, and no
> stored history of response times or error rates. The single automated alert
> (`/api/cron/alert-check`, daily) evaluates boolean conditions, not numbers.
>
> The previous version of this document presented an "executive summary" with
> SLO budget calculations, per-KPI validation verdicts and recommended
> adjustments for email delivery time, queue depth and Gmail API availability —
> metrics from a queue-and-worker architecture this project does not have, and
> numbers no one had measured. It has been replaced with this: what a real
> validation would require, and what would have to exist first.

**Status:** rewritten 2026-09-10.
**Companion:** `ops/THRESHOLDS_EXPLAINED.md` (the proposed values themselves).

> **Migration note:** `task.conto.ec` and Supabase ref `txdyijyswpsalqnwfopc`
> belong to the **current** accounts. See [`MIGRACION.md`](../MIGRACION.md).

---

## 1. Validation status, per threshold

| Threshold | Source | Enforced? | Validated against data? |
|---|---|---|---|
| Supabase probe fails → 503 | `src/app/api/health/route.ts` | **Yes** | Binary — no threshold to validate. Verified working in production 2026-09-10 |
| pg_cron job stale/failed → `degraded` | `get_cron_health()` RPC | **Yes** | Staleness windows were chosen when the RPC was written; never checked against run-history statistics |
| 30 req/min per caller on `/api/mcp` | `src/lib/rate-limit.ts` | **Yes** | No — chosen as a default; no traffic study exists |
| Latency / error-rate / availability numbers | `ops/THRESHOLDS_EXPLAINED.md` §2 | **No** | No — reasoned starting points only |
| KPI targets in `ops/1-monitoring-alerts.yaml`, `ops/6-metrics-dashboard.json` | those files | **No — read by nothing** | No — they describe a different system |

The only production measurement on record is a single `/api/health` call on
2026-09-10: `latencyMs` 754 on a cold invocation. One sample is not a baseline.

---

## 2. What a real validation would require

In order; each step is a prerequisite for the next.

1. **Collect data.** Nothing stores response times today. The cheapest source is
   an external uptime monitor recording response times for `/api/health` and
   `/` — that alone produces the availability and latency series everything else
   depends on. `/api/health` is deliberately cheap and needs no auth, so it can
   be polled at any frequency.
2. **Separate cold from warm invocations.** On Vercel serverless, cold starts
   dominate the tail. A p95 that mixes them will justify thresholds that page on
   normal behaviour.
3. **Gather at least two weeks**, covering a weekend and a working week —
   TaskFlow traffic is workday-shaped, so a Tuesday-only sample is not
   representative.
4. **Compute p50 / p95 / p99 per endpoint**, then set warning near p95 and
   critical near p99 for latency, rather than at round numbers.
5. **Count real incidents.** A threshold is validated when you can say how many
   true positives and false positives it produced over the observation window.
6. **Re-check the known false-positive cases** before tightening anything:
   post-restore cron staleness, cold-start latency, and a job checked one minute
   after its own scheduled run.

Until step 1 exists, every number in `ops/THRESHOLDS_EXPLAINED.md` §2 is a
proposal.

---

## 3. SLO framing — deliberately not asserted

No service-level objective has been agreed for TaskFlow, and no error budget is
being tracked. Asserting "99.9% availability" here would be documentation
fiction: nothing measures availability, so nothing could detect a breach.

If an SLO is wanted, the smallest honest version is:

* **SLI:** fraction of `/api/health` probes returning 200, measured by an
  external monitor.
* **Objective:** to be chosen by the project owner, informed by §2's baseline.
* **Error budget:** derived from that objective, over a stated window.

Note the dependency chain the objective inherits: Supabase, Vercel, and DNS for
`task.conto.ec`. TaskFlow cannot promise more availability than its providers,
and none of their SLAs have been reviewed for this project.

---

## 4. Validation checklist

Use this when alerting is finally built; nothing here is currently checked off.

- [ ] An external uptime monitor records response times for `/api/health` and `/`
- [ ] At least two weeks of data collected, weekend included
- [ ] Cold and warm invocations distinguishable in the data
- [ ] p50/p95/p99 computed per endpoint and written down
- [ ] Latency thresholds derived from those percentiles, with sustained windows
- [ ] pg_cron staleness windows compared against real `cron.job_run_details` history
- [ ] `ALERT_WEBHOOK_URL` configured, and a test alert seen to arrive
- [ ] Each alert reviewed after 30 days for true/false-positive count
- [ ] Rationale for every threshold recorded in the commit that sets it

---

## 5. Known measurement gaps

* `/api/health` reports `latencyMs` per call; **nothing stores it**.
* Sentry samples 10% of traces, and its browser SDK loads lazily (first
  interaction, or 5s after paint), so early client errors and most client
  transactions are absent (`ops/7-error-tracking-config.md` §2.1).
* No `/metrics` endpoint exists, so the Prometheus config in `config/` has
  nothing to scrape.
* `public.failed_jobs` accumulates notification failures but nothing counts or
  alerts on its rate.
* Alerting runs once daily, so any rate-based threshold would be evaluated at
  most once a day even if one were implemented.

---

## 6. References

* `ops/THRESHOLDS_EXPLAINED.md` — the proposed thresholds and their reasoning
* `ops/MONITORING_GUIDE.md` — what is and isn't monitored, and the caveats on
  the example Grafana/Prometheus config
* `ops/HEALTH_CHECK_GUIDE.md` — the checks that actually run, and their known
  false positives
* `src/lib/cron-jobs.ts`, `src/lib/rate-limit.ts`
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against the repository:** 2026-09-10
