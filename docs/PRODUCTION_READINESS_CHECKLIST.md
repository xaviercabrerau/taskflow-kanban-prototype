# Production Readiness Checklist

**Last verified against the code:** 2026-09-10 — every item below was checked
item by item against the repository, `package.json`, `vercel.json`,
`next.config.ts`, `src/proxy.ts` and the route handlers.

> **This document was rewritten on 2026-09-10.** Earlier revisions tracked "11
> blockers" assigned to "Agent 1–4", a `staging.taskflow.app` environment, Slack
> webhooks, PagerDuty, a Gmail service account, `REDIS_URL`, `npm run
> test:integration` and `npm run security:audit`. **None of those exist in this
> project.** They have been removed rather than carried forward. Historical
> context, if you want it, is in
> [`BLOCKERS_RESOLUTION_SUMMARY.md`](./BLOCKERS_RESOLUTION_SUMMARY.md) and
> [`HARDCODED_URLS_MIGRATION.md`](./HARDCODED_URLS_MIGRATION.md).

**TaskFlow is already deployed and running in production at
<https://task.conto.ec>.** This is therefore a *keep-it-healthy* checklist, not a
pre-launch gate.

> **Migration note:** the identifiers in this document — host `task.conto.ec`,
> Supabase project ref `txdyijyswpsalqnwfopc`, Vercel project
> `taskflow-kanban-prototype` (projectId `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`,
> orgId `team_LUyGoTDapYDMjHCRVzQaFiaX`) — belong to the current account. To move
> the project elsewhere, follow [`MIGRACION.md`](../MIGRACION.md).
> **Never write a secret value into this file — variable names only.**

---

## 1. Build, tests and types — ✅ DONE

| Item | State | Evidence |
|---|---|---|
| Unit test suite passes | ✅ | `npm test` → 15 suites / 215 tests, all passing |
| Type check clean | ✅ | `npx tsc --noEmit` (no npm script — run it directly) |
| Lint configured | ✅ | `npm run lint` (`eslint.config.mjs`) |
| Production build | ✅ | `npm run build` (Next.js 16.3.0) |
| Integration test suite | ❌ **does not exist** | There is no `npm run test:integration` |
| E2E / browser tests | ❌ **does not exist** | No jsdom, RTL, Playwright or Cypress |
| CI gate running the tests | ❌ **not configured in this repo** | No workflow file enforces `npm test` before deploy |

**Genuinely pending:** component/E2E coverage and a CI gate. Today, the only
thing standing between a broken commit and production is running these four
commands by hand. See [`TESTING.md`](./TESTING.md).

## 2. Deployment — ✅ DONE

| Item | State | Notes |
|---|---|---|
| Hosting | ✅ | Vercel, project `taskflow-kanban-prototype` |
| Branch model | ✅ | Work happens on `main`; deploy with `vercel deploy --prod` |
| Custom domain | ✅ | `task.conto.ec` |
| Cron | ✅ | Exactly **one** in `vercel.json`: `/api/cron/alert-check` at `0 8 * * *` (08:00 UTC daily) |
| Staging environment | ❌ **does not exist** | There is no `staging.taskflow.app`. Verify on production before and after deploying |
| Rollback | ✅ (platform) | Vercel's "Promote to Production" on a previous deployment |

## 3. Security headers and transport — ✅ DONE

Verified in `next.config.ts` and `src/proxy.ts`:

- [x] `Content-Security-Policy` generated **per request with a unique nonce** in
      `src/proxy.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`), so
      production does not need `'unsafe-inline'`
- [x] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [x] `X-Content-Type-Options: nosniff`
- [x] `X-Frame-Options: DENY`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Permissions-Policy: geolocation=(), camera=(), microphone=()`
- [x] `poweredByHeader: false` (no `X-Powered-By` fingerprint)

## 4. Endpoint authentication — ✅ DONE, with caveats

All 31 route files were re-read on 2026-09-10. Full matrix and findings in
[`SECURITY_ENDPOINTS_CHECKLIST.md`](./SECURITY_ENDPOINTS_CHECKLIST.md).

- [x] Admin write routes require a Supabase session **and** `org_role = 'owner'`
- [x] Internal routes gated by `INTERNAL_NOTIFY_SECRET` with `timingSafeEqual`
- [x] Cron route gated by `CRON_SECRET` with `timingSafeEqual`
- [x] Public API v1 / MCP validate `tfmcp_` PATs inside SECURITY DEFINER RPCs
- [x] Service-role key used only server-side, and only where RLS makes it
      necessary (`profiles` updates, `auth.admin.*`)
- [ ] **Open — SEC-1:** `/api/health/cron` answers with no auth at all (the
      `anon` grant on `get_cron_health()` bypasses the header forwarding).
      Low-sensitivity data; documented as an accepted tradeoff in the route
- [ ] **Open — SEC-2:** `/api/cron/alert-check` accepts `?secret=<CRON_SECRET>`
      in the URL, which lands in access logs
- [ ] **Open — SEC-3:** `/api/admin/import-tasks/template` requires a session but
      not owner
- [ ] **Open — SEC-4:** membership lookups use `.maybeSingle()` without an
      `organization_id` filter — a user in two organizations gets locked out
- [ ] **Open — SEC-5:** `/api/share-links/[id]` DELETE relies solely on RLS and
      returns raw error text in its `500`

## 5. Rate limiting — ✅ DONE

- [x] `@upstash/ratelimit` + `@upstash/redis`, 30 requests / rolling minute per
      caller (`src/lib/rate-limit.ts`)
- [x] Keyed on a **SHA-256 hash** of the bearer token — raw tokens are never
      stored or logged; `X-Forwarded-For` is deliberately not used as a boundary
- [x] Applied to `/api/mcp`, `/api/v1/*`, every `/api/tasks/*`, share-link
      creation and both public share routes
- [x] **Fails closed**, not open: with Upstash unconfigured or unreachable it
      degrades to a conservative in-memory 10/min fixed window
- [ ] **Verify per environment:** the limiter accepts either
      `UPSTASH_REDIS_REST_URL`/`_TOKEN` or `KV_REST_API_URL`/`_TOKEN` (the Vercel
      Marketplace integration provisions the latter). If neither is set, you are
      silently on the weaker in-memory fallback — check the deploy logs for the
      `[rate-limit] No Upstash Redis credentials found` warning

## 6. Database — ✅ DONE

- [x] Supabase Postgres, project ref `txdyijyswpsalqnwfopc`
- [x] **114 versioned migrations** in `supabase/migrations/`
- [x] Project rule: schema changes **only** via versioned migration files, never
      loose SQL
- [x] RLS in force; content mutations authorized through `role_assignments` via
      `has_permission(...)`, **not** `organization_members.org_role` (the two are
      separate systems — see [`ARCHITECTURE.md`](./ARCHITECTURE.md))
- [ ] **Not verified here:** backup/restore has not been exercised. Supabase's
      automatic backups exist on the plan, but no restore drill is documented

## 7. Observability — ⚠️ PARTIAL

| Concern | State |
|---|---|
| Error tracking | ✅ Sentry (`@sentry/nextjs` ^10.70.0), minimal config — [`SENTRY_SETUP.md`](./SENTRY_SETUP.md) |
| Liveness probe | ✅ `GET /api/health` (public, safe at any frequency) |
| Cron health | ✅ `GET /api/health/cron` (but see SEC-1) |
| Daily alerting | ✅ `/api/cron/alert-check` posts to `ALERT_WEBHOOK_URL` |
| Source maps in Sentry | ❌ not configured — production stack traces are minified |
| Release tracking | ❌ `VERCEL_GIT_COMMIT_SHA` is available but not passed to `Sentry.init` |
| Client-side early errors | ⚠️ the client SDK loads only after first interaction or +5s, by design — hydration crashes go unreported |
| Datadog | ❌ **never implemented** — [`DATADOG_SETUP.md`](./DATADOG_SETUP.md) is a reference guide only |
| PII scrubbing in error reports | ❌ **never implemented** — no `beforeSend` anywhere; [`PII_SCRUBBING.md`](./PII_SCRUBBING.md) is a design reference only |
| Prometheus / Grafana | ⚠️ `docker-compose.grafana.yml` and `config/grafana`, `config/prometheus` exist as local scaffolding, not wired to production |

## 8. Email and notifications — ✅ DONE

- [x] Resend (`resend` ^4.0.1) + `react-email` ^6.9.2 templates
- [x] `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`
- [x] Template output HTML-escaped via `sanitizeForEmail`
- [x] Covered by tests (`src/lib/emails/__tests__/*`, `src/lib/notifications/__tests__/notify.test.ts`)
- [ ] Sender domain verification in Resend must be redone on any account move

## 9. Compliance — ❌ NOT DONE (and not scheduled)

- [ ] GDPR erasure endpoint — **does not exist**
- [ ] GDPR data-portability export — **does not exist**
- [ ] PII scrubbing in logs and error reports — **does not exist**
- [x] Audit trail **does** exist, but as database-level audit tables plus the
      `/admin/auditoria` page — not as an HTTP API. See
      [`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md)
- [x] `PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` exist at the repo root

Earlier documents listed the first three as "CRITICAL, required before v1.0". The
product shipped without them. They are **new work**, not pending work — decide
deliberately whether they are needed.

## 10. Dependencies — ✅ DONE, one deliberate exception

- [x] Next.js 16.3.0, React 19.2.8, TypeScript 5
- [x] **`xlsx` is installed from the SheetJS CDN**
      (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), **not** from npm.
      This is intentional: the npm-registry build has two unpatched HIGH
      vulnerabilities (prototype pollution + ReDoS) that SheetJS only fixes on
      its own CDN. **Do not "fix" this by switching to `xlsx: ^0.18.5`.**
      A dependency-audit tool will flag the CDN URL as unusual — that is expected
- [ ] No automated dependency scanning is wired up in this repo

---

## Pre-deploy routine (what to actually run)

```bash
npm test           # expect 15 suites / 215 tests passing
npx tsc --noEmit   # expect no output
npm run lint
npm run build

vercel deploy --prod

# verify after
curl -s https://task.conto.ec/api/health
```

Because there is no staging environment and deploys go straight to `main`, verify
the health endpoint both **before** and **after** each deploy, and keep the
previous Vercel deployment ready to promote if something breaks.

---

## Summary

| Area | State |
|---|---|
| Build, deploy, domain, cron | ✅ done |
| Security headers, CSP with nonce, HSTS | ✅ done |
| Endpoint auth | ✅ done — 5 open findings, none critical |
| Rate limiting | ✅ done — verify Upstash vars per environment |
| Database, RLS, migrations | ✅ done — no restore drill |
| Unit tests | ✅ done — 15/215 |
| Component / E2E tests, CI gate | ❌ not done |
| Error tracking (Sentry) | ⚠️ working, minimal |
| Datadog, PII scrubbing, GDPR endpoints | ❌ never implemented |

---

**Related:** [`SECURITY_ENDPOINTS_CHECKLIST.md`](./SECURITY_ENDPOINTS_CHECKLIST.md) ·
[`API_ENDPOINTS.md`](./API_ENDPOINTS.md) · [`TESTING.md`](./TESTING.md) ·
[`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
[`MIGRACION.md`](../MIGRACION.md)
