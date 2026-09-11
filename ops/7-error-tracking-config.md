# Error Tracking & Logging — TaskFlow

**Status:** describes the configuration that is actually in this repository,
verified 2026-09-10. This replaces an earlier version that documented Sentry
release automation, a `.sentry/sentry.conf.yaml`, Datadog/PagerDuty routing, a
structured-logging library, an on-call rotation and scheduled digest alerts —
none of which exist in this project.

> **Migration note:** the account-bound values referenced here (the domain
> `task.conto.ec`, Supabase ref `txdyijyswpsalqnwfopc`, the Vercel project, and
> the Sentry project behind the DSN env vars) belong to the **current**
> accounts. Moving the project: [`MIGRACION.md`](../MIGRACION.md). A Sentry DSN
> is account-bound: a new account means new `SENTRY_DSN` /
> `NEXT_PUBLIC_SENTRY_DSN` values.

---

## 1. What error tracking exists

| Layer | Mechanism | Where it goes |
|---|---|---|
| Server (Node runtime) | `sentry.server.config.ts`, loaded by `instrumentation.ts` `register()` | Sentry, if `SENTRY_DSN` is set |
| Server (Edge runtime) | `sentry.edge.config.ts`, same entry point | Sentry, if `SENTRY_DSN` is set |
| Server Components / Route Handlers / Server Actions | `export const onRequestError = Sentry.captureRequestError` in `instrumentation.ts` | Sentry |
| Browser | `instrumentation-client.ts` → **lazily** imports `sentry.client.config.ts` | Sentry, if `NEXT_PUBLIC_SENTRY_DSN` is set |
| Notification send failures | rows in `public.failed_jobs` | Supabase |
| Everything else (`console.*`, uncaught) | Vercel Function logs | `vercel logs <deployment-url>` |
| Health degradation | `/api/cron/alert-check` → `ALERT_WEBHOOK_URL` | Slack/Discord webhook, once a day |

That is the whole picture. There is no log aggregation service, no APM beyond
Sentry's 10% trace sampling, and no paging integration.

---

## 2. Sentry, exactly as configured

Package: `@sentry/nextjs` ^10.70.0.

```ts
// sentry.server.config.ts  and  sentry.edge.config.ts
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });

// sentry.client.config.ts
Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 });
```

Environment variable names (values live in Vercel, never here):

* `SENTRY_DSN` — server and edge.
* `NEXT_PUBLIC_SENTRY_DSN` — browser.
* `NEXT_RUNTIME` — set by Next.js itself; `instrumentation.ts` branches on it.

**If the DSN is unset, `Sentry.init` silently no-ops.** That is deliberate — no
guard code is needed — but it also means "no errors in Sentry" can mean "Sentry
isn't configured in this environment". Check first:

```bash
vercel env ls production | grep -i sentry     # names only, never values
```

### 2.1 Three real limitations — know them before trusting Sentry

1. **The browser SDK is loaded lazily.** `instrumentation-client.ts` defers the
   `import()` of `sentry.client.config.ts` until the first real user
   interaction (`click`, `keydown`, `scroll`, `pointermove`) or 5 seconds after
   first paint, whichever comes first. This keeps ~143 KB gzip out of the
   critical bundle. **Accepted tradeoff: an error before that point — e.g. a
   crash during initial hydration — is never reported.** If you are chasing a
   "white screen on load" report, Sentry is the wrong place to look; use the
   browser console and `vercel logs`.
2. **`tracesSampleRate` is 0.1.** Performance data covers ~10% of transactions.
   Do not draw latency conclusions from small samples.
3. **There is no `withSentryConfig` wrapper in `next.config.ts`.** Consequences:
   no automatic source-map upload (stack traces from the browser are minified),
   no release/commit association, and no tunnel route to bypass ad blockers.
   Adding it is a real improvement, not something to document as if done.

### 2.2 What is NOT configured

No `beforeSend` scrubbing, no `environment`/`release` tags, no custom
`ignoreErrors`, no alert rules in code, no Sentry CLI usage anywhere in the
repo, no `SENTRY_AUTH_TOKEN`. Alert rules, if any, exist only in the Sentry UI —
they are not version-controlled with this project.

---

## 3. Logging

There is no logging library and no structured-log format. The app uses
`console.log` / `console.warn` / `console.error`, which land in the Vercel
Function logs.

```bash
vercel ls                                   # find the deployment
vercel logs <deployment-url>                # stream/tail
vercel logs <deployment-url> | grep '\[rate-limit\]'
```

Log lines worth knowing by sight:

| Line | Meaning | Where |
|---|---|---|
| `[rate-limit] No Upstash Redis credentials found ...` | Rate limiting silently degraded to a per-instance in-memory limiter | `src/lib/rate-limit.ts` |
| `Notification event validation failed: ...` | A malformed notification event was dropped on purpose; no email sent | `src/lib/notifications/notify.ts` |
| `Alert webhook responded with <status>` / `Failed to POST to ALERT_WEBHOOK_URL` | The daily health alert could not be delivered; the alert text is in the log line itself | `src/app/api/cron/alert-check/route.ts` |
| `TaskFlow alert (<ts>): ...` via `console.error` | Health problems detected **and no `ALERT_WEBHOOK_URL` configured** — nobody was notified | same |

Supabase-side logs (Postgres errors, API, Auth) are in the Supabase dashboard
for project `txdyijyswpsalqnwfopc`, not in Vercel.

**Retention is whatever Vercel and Supabase give you on the current plan.**
Nothing in this project archives logs.

---

## 4. The one persisted error table: `public.failed_jobs`

Created in `supabase/migrations/20260828190000_notification_system_schema_reconciliation.sql`.
It is the notification path's own error trail — RLS-enabled, internal ops data,
never exposed to end users.

```sql
select * from public.failed_jobs order by created_at desc limit 20;
```

Because notification delivery is synchronous and best-effort
(`src/lib/notifications/notify.ts`), a row here means: the send was attempted,
it failed, the underlying user action still succeeded, and **it will not be
retried**. There is no worker to retry it.

An empty `failed_jobs` with a missing email means the send was never attempted —
check the Postgres trigger and `/api/internal/notify-event` instead
(`ops/5-troubleshooting-guide.md` §3).

---

## 5. Alerting

The only automated alert path in the project:

```
Vercel Cron (0 8 * * *)  →  GET /api/cron/alert-check   (auth: CRON_SECRET)
                              ├─ Supabase connectivity probe
                              └─ get_cron_health()  (7 pg_cron jobs)
                                     └─ problems? → POST ALERT_WEBHOOK_URL
```

Environment variable names: `CRON_SECRET`, `ALERT_WEBHOOK_URL`.

The webhook payload carries both `text` (Slack incoming webhooks) and `content`
(Discord) so one implementation serves either provider — each ignores the key it
doesn't recognize.

Manual exercise (export the secret in your shell; never write it to a file):

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://task.conto.ec/api/cron/alert-check | jq
# {"ok":true,"problems":[],"alerted":false,"timestamp":"..."}
```

**Known gaps, stated plainly:**

* It runs **once a day**, so detection latency for a broken hourly pg_cron job
  is up to ~24 hours.
* With `ALERT_WEBHOOK_URL` unset, alerts are only `console.error`'d into the
  function logs.
* Sentry errors do **not** feed this path. A spike of 500s produces no webhook.
* To tighten detection without new code: point an external uptime monitor at
  `https://task.conto.ec/api/health` (cheap, no auth) and at
  `https://task.conto.ec/api/cron/alert-check?secret=<CRON_SECRET>` — the
  query-param form exists precisely for monitors that cannot send custom
  headers.

---

## 6. Error categories seen in this app

Practical triage list, replacing the earlier generic taxonomy.

| Category | Typical signature | First move |
|---|---|---|
| Supabase unreachable | `/api/health` → 503 with a `message` | `ops/3-runbooks.md` §3 |
| Missing env var | `NEXT_PUBLIC_SUPABASE_URL/... must be set` | Add in Vercel, then **redeploy** (env vars bake in at build time) |
| RLS / permission | Query returns 0 rows with no error, or `permission denied for function is_org_member` | `ops/5-troubleshooting-guide.md` §2 — usually `role_assignments`, not a bug |
| pg_cron failure | `/api/health/cron` degraded; `cron.job_run_details.return_message` | `ops/3-runbooks.md` §4 |
| Email delivery | Row in `failed_jobs`, or Resend dashboard | `ops/5-troubleshooting-guide.md` §3 |
| Rate limiting | HTTP 429 from `/api/mcp`, or the `[rate-limit]` warning | `ops/5-troubleshooting-guide.md` §5 |
| Import errors | Per-row errors from `POST /api/admin/import-tasks` | Partial import is by design; row 1 = first data row |
| Unauthorized cron call | 401 from `/api/cron/alert-check` | `CRON_SECRET` mismatch between Vercel and the caller |

---

## 7. Never put secrets in errors or docs

* Documentation names environment variables; it never contains their values.
* The service-role key bypasses **every** RLS policy. It is deliberately kept
  out of the health endpoints — `/api/health/cron` uses the
  `get_cron_health()` SECURITY DEFINER RPC instead, so the elevated privilege
  stays inside Postgres, scoped to one query.
* Sentry has no `beforeSend` scrubber configured, so avoid putting tokens,
  emails or raw request bodies into thrown error messages.
* If a credential is exposed: `ops/4-backup-disaster-recovery.md` §7.4 (rotate,
  then redeploy — env vars only take effect on a new build).

---

## 8. Improvement backlog (honest list)

Not done; do not document these as if they were.

1. Wrap `next.config.ts` with `withSentryConfig` for source maps and releases.
2. Set `environment` and `release` in `Sentry.init`.
3. Add a `beforeSend` scrubber.
4. Increase alerting frequency, or add an external uptime monitor (§5).
5. Route Sentry issues into the same webhook as health alerts.

---

## 9. References

* `instrumentation.ts`, `instrumentation-client.ts`
* `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`
* `next.config.ts` — security headers; note the absence of `withSentryConfig`
* `src/app/api/cron/alert-check/route.ts` — the only alerting path
* `src/lib/notifications/notify.ts` — writes `failed_jobs`
* `.env.example` — authoritative environment variable names
* `ops/3-runbooks.md`, `ops/5-troubleshooting-guide.md`, `ops/4-backup-disaster-recovery.md`
* [`MIGRACION.md`](../MIGRACION.md)

---

**Last verified against the codebase:** 2026-09-10
