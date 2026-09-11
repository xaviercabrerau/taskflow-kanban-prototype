# Deployment Guide

**Last verified against the code:** 2026-09-09 (`package.json`, `vercel.json`,
`.env.example`, `src/app/api/health/route.ts`, git remote).

> **Migration note:** the repo, Vercel project and domain below belong to the current
> account. If the project moves to another GitHub/Vercel/Supabase account, follow
> [`MIGRACION.md`](../MIGRACION.md) instead of this document — it covers creating the
> destination projects, moving data and auth users, and the full list of values to
> replace.

---

## 1. Where this deploys

| | Value |
|---|---|
| Repository | `https://github.com/xaviercabrerau/taskflow-kanban-prototype` |
| Branch | `main` — work and deploys happen **directly on `main`**, there is no develop/staging branch |
| Vercel project | `taskflow-kanban-prototype` |
| Vercel `projectId` | `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF` |
| Vercel `orgId` | `team_LUyGoTDapYDMjHCRVzQaFiaX` |
| Production URL | `https://task.conto.ec` |
| Supabase project ref | `txdyijyswpsalqnwfopc` |

The `.vercel/project.json` file in the repo already carries the project/org IDs, so
`vercel deploy` from the repo root targets the right project without extra flags.

---

## 2. The actual deployment procedure

```bash
# 1. Pre-flight, locally
npm test               # 15 suites, 215 tests — must be green
npx tsc --noEmit       # no type errors (there is no dedicated npm script)
npm run lint
npm run build

# 2. Push the code
git push origin main

# 3. Deploy to production
vercel deploy --prod

# 4. Verify production
curl -s https://task.conto.ec/api/health
```

`/api/health` returns `200` with:

```json
{ "status": "ok", "checks": { "supabase": { "ok": true, "latencyMs": 42 } }, "timestamp": "..." }
```

and `503` with `"status": "error"` plus the failing check when Supabase is unreachable.
It probes the `permissions` table (a global catalog readable by `anon`) — deliberately
not a tenant-scoped table, whose RLS helpers `anon` may not execute.

`GET /api/health/cron` reports the state of the `pg_cron` jobs
(`purge-expired-audit-logs`, `taskflow_resolve_crm_sync_responses`, due-soon/SLA checks;
see `src/lib/cron-jobs.ts`).

### Database migrations

Schema changes are **only** applied through versioned files in `supabase/migrations/`
(114 files today). Never run loose SQL against the remote database: a change that is not
in a migration file is invisible to `git`, to reviewers, and to any future migration to
another Supabase project.

Apply pending migrations before the deploy that depends on them, so production code
never runs against an older schema.

---

## 3. Environment variables

The authoritative list is `.env.example` at the repo root — it documents only variables
that the app or its scripts actually read. Copy it to `.env.local` for local
development; in production these live in Vercel → Project Settings → Environment
Variables.

**Never write values into documentation.** Only variable names belong here.

### Required

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (exposed to the browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (exposed to the browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Bypasses RLS for admin flows (user creation, password reset, notification sending, integration clients). **Must never carry a `NEXT_PUBLIC_` prefix.** |
| `NEXT_PUBLIC_APP_URL` | Base URL used to build absolute links in outgoing email |

### Email notifications

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `NOTIFICATION_FROM_EMAIL` | From address; its domain must be verified in Resend |

### Rate limiting / cache

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis (direct) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Same thing under the legacy Vercel KV naming that the Vercel Marketplace "Upstash for Redis" integration provisions. `src/lib/rate-limit.ts` accepts **either** pair |

Without either pair, rate limiting falls back to a weak in-memory limiter — acceptable
locally, not in production.

### Application secrets

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Vercel Cron sends it as `Authorization: Bearer …` (or `?secret=`) to `/api/cron/alert-check` |
| `INTERNAL_NOTIFY_SECRET` | `x-internal-secret` header for `/api/internal/notify-event` and `/api/internal/sync-calendar-event`, called by Postgres triggers via `pg_net` |
| `JWT_SECRET` | Signs/verifies the Google OAuth `state` param (`src/lib/google/oauth.ts`) — unrelated to Supabase Auth's own JWTs. (Public API v1 authenticates with PATs validated in Postgres, not with this secret.) |
| `ALERT_WEBHOOK_URL` | Incoming webhook the alert cron posts to when a health check fails |

### Optional integrations

| Variable | Purpose |
|---|---|
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Error tracking |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | Server-side Google OAuth (Calendar, Drive, Gmail send) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Client-side Google Drive Picker |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Non-prefixed duplicates used only by the local scripts in `scripts/`, not by the app |

`NODE_ENV` and `VERCEL_GIT_COMMIT_SHA` are set automatically by Next.js/Vercel — do not
set them manually.

Step-by-step instructions for obtaining each of these credentials are in
[`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md).

---

## 4. Scheduled jobs

**Vercel cron — `vercel.json` defines exactly one:**

```json
{ "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
```

Daily at 08:00 UTC. Any doc claiming additional Vercel crons is out of date.

**`pg_cron` jobs run inside Supabase**, not on Vercel, and are created by migrations.
They survive a Vercel migration but **not** a Supabase migration — a new Supabase
project must have them re-created by re-running the migrations.

### Hard-coded production URLs in triggers

Several notification triggers call
`net.http_post(url := 'https://task.conto.ec/api/internal/notify-event', …)` with the
domain as a **literal inside the migration file** (see
`20260830150000_fix_notify_eventtype_and_url_regression.sql`). If the production domain
changes, these must be updated by writing a new migration — there is no environment
variable to flip.

---

## 5. Pre-deployment checklist

**Code**
- [ ] `npm test` green (15 suites / 215 tests)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds

**Database**
- [ ] Every schema change is a file in `supabase/migrations/`, not loose SQL
- [ ] Pending migrations applied before the code that needs them
- [ ] RLS policies reviewed for any new table (default-deny, tenant-scoped)
- [ ] Supabase PITR/backups enabled

**Configuration**
- [ ] All required env vars present in the Vercel environment
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is server-only (no `NEXT_PUBLIC_` prefix, not committed)
- [ ] Rate limiting configured (Upstash or Vercel KV pair)

**After the deploy**
- [ ] `curl -s https://task.conto.ec/api/health` → `"status":"ok"`
- [ ] `curl -s https://task.conto.ec/api/health/cron` → cron jobs healthy
- [ ] Log in and create a task (exercises RLS + `has_permission`)
- [ ] Sentry shows no new error burst

---

## 6. Rollback

**Application:** Vercel → Deployments → pick the previous production deployment →
*Promote to Production*. Or redeploy a known-good commit:

```bash
git revert <bad-commit>
git push origin main
vercel deploy --prod
```

**Database:** a migration that has already run cannot be undone by promoting an older
deployment. Roll a schema change back with a **new forward migration**. For data
corruption, use Supabase → Database → Backups → point-in-time restore.

Because code and schema roll back independently, prefer backward-compatible migrations
(add columns before using them, drop them a deploy later).

---

## 7. Common issues

**`"El servidor no tiene configurado SUPABASE_SERVICE_ROLE_KEY"` (500)**
`POST /api/admin/users`, `/api/admin/create-user`, `/api/admin/link-existing-user` and
`/api/admin/reset-password` need the service-role key. Read-only endpoints keep working
without it, which makes this look intermittent. Add the variable in Vercel and redeploy.

**A newly created user can log in but cannot create tasks**
Not a deployment problem. `org_role` does not grant `task.create`; permissions come from
`role_assignments`. See the RBAC section in
[`ARCHITECTURE.md`](./ARCHITECTURE.md#org_role-vs-rbac-two-separate-systems) and
[`USER_MANAGEMENT.md`](./USER_MANAGEMENT.md).

**No rate-limit headers in responses**
Neither the `UPSTASH_REDIS_REST_*` nor the `KV_REST_API_*` pair is set, so
`src/lib/rate-limit.ts` fell back to the in-memory limiter.

**Emails not arriving**
Check `RESEND_API_KEY`, that `NOTIFICATION_FROM_EMAIL`'s domain is verified in Resend,
and the `failed_jobs` table — the send path is synchronous and best-effort, with no
retry queue, so failures are recorded there rather than retried.

**Notification triggers stopped firing after a domain change**
See the hard-coded trigger URLs in section 4.

---

## 8. Disaster recovery

| Component | Mechanism | Notes |
|---|---|---|
| Database | Supabase PITR / backups | Verify the retention on the current Supabase plan |
| Schema | `supabase/migrations/` in git | Re-runnable against an empty project — this is why loose SQL is banned |
| Application | Git + Vercel deployment history | Promote a previous deployment |
| Secrets | Vercel environment variables | Keep a secure out-of-band copy; they are not in git |
| Integration credentials | Supabase Vault | Not covered by a Vercel restore; re-enter after a Supabase migration |

Full account-migration procedure: [`MIGRACION.md`](../MIGRACION.md).
