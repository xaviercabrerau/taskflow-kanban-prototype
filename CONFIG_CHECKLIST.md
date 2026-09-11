# TaskFlow — Configuration Checklist

> **What this document covers:** the tick-list you run through *before* a
> deployment, to confirm the environment is completely and correctly
> configured — environment variables, Vercel, Supabase, cron and external
> services.
> **Where to go for anything else:**
> • The deployment procedure itself → [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
> • Standing up a brand-new environment → [`DEPLOYMENT_PLAN.md`](./DEPLOYMENT_PLAN.md)
> • Where each value comes from → [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md)
> • Secret handling and rotation → [`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md)
> • Moving to different accounts → [`MIGRACION.md`](./MIGRACION.md)

**Last verified:** 2026-09-09 against the code, `vercel.json`, `package.json`
and Supabase.

This is a checklist, not a tutorial. It records **only what this project
actually uses.**

---

## 1. Environment variables

Set in *Vercel → Settings → Environment Variables* (Production, Preview,
Development) and in a local, git-ignored `.env.local`. Names only — never write
values here or anywhere else in the repo.

### Required — the app will not work without these

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (server-side only; bypasses all RLS)
- [ ] `NEXT_PUBLIC_APP_URL` (production: `https://task.conto.ec`)

### Required for notifications

- [ ] `RESEND_API_KEY`
- [ ] `NOTIFICATION_FROM_EMAIL` — on a domain **verified in Resend**

### Required for real rate limiting

One of the two pairs (`src/lib/rate-limit.ts` accepts either):

- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, **or**
- [ ] `KV_REST_API_URL` + `KV_REST_API_TOKEN` (what the Vercel "Upstash for
      Redis" integration provisions)

Without either, rate limiting silently falls back to a weak in-memory limiter
that does not hold across serverless instances.

### Application secrets — generate with `openssl rand -base64 32`

- [ ] `CRON_SECRET` — gates `/api/cron/alert-check`
- [ ] `INTERNAL_NOTIFY_SECRET` — gates `/api/internal/*`
- [ ] `JWT_SECRET` — public API v1 tokens + Google OAuth `state`.
      **Changing it invalidates every API key already issued to users.**

### Optional

- [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
- [ ] `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (instrumented, currently unset)
- [ ] `ALERT_WEBHOOK_URL` (Slack/Discord incoming webhook for cron alerts)

### Local scripts only

- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY` — read by `scripts/`, not by the app

### Not used — do not configure

`GMAIL_SERVICE_ACCOUNT_JSON`, `GMAIL_SENDER_EMAIL`, `GOOGLE_CLOUD_PROJECT_ID`,
`STAFF_API_KEY`, `REDIS_URL`, `LOG_LEVEL`, `RATE_LIMIT_MAX`,
`NEXT_PUBLIC_VERCEL_URL`, `SLACK_WEBHOOK_URL`, `PAGERDUTY_*`, `TWILIO_*`,
`DATADOG_*` / `DD_*`, `SMTP_*`, `ALERTS_EMAIL_RECIPIENTS`,
`ERROR_DIGEST_EMAIL_RECIPIENTS`, `ON_CALL_EMAIL`, `TASKFLOW_URL`,
`API_BASE_URL`. None are read anywhere in the codebase; they are leftovers from
a generic observability boilerplate.

### Verify

```bash
vercel env ls                          # names configured per environment
grep -oE '^[A-Z_]+' .env.local | sort  # names present locally (not values)
```

> `scripts/validate-environment.sh` still checks that obsolete list
> (Slack/PagerDuty/Twilio/Datadog/Gmail). Do not rely on it; use this section.

---

## 2. Vercel project

- [ ] Project: `taskflow-kanban-prototype`
      (`projectId: prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`,
      `orgId: team_LUyGoTDapYDMjHCRVzQaFiaX`)
- [ ] Framework preset: **Next.js**; build `npm run build`, install `npm install`
- [ ] **Root Directory is the repository root.** A wrong Root Directory once
      caused 10+ days of silently failing production deployments — check it
      when builds succeed but the site does not update.
- [ ] Node.js version ≥ 20.9.0 (required by Next.js 16)
- [ ] Git integration points at `xaviercabrerau/taskflow-kanban-prototype`,
      branch `main` (worked on and deployed directly, no intermediate branch)
- [ ] Domain `task.conto.ec` assigned in *Settings → Domains*, DNS resolving,
      TLS certificate issued
- [ ] The build can reach `https://cdn.sheetjs.com` — the `xlsx` dependency is
      installed from the SheetJS CDN, not npm (deliberate: the npm build has two
      unpatched HIGH vulnerabilities). Do not "fix" it to `xlsx: ^0.18.5`.

> **Migration note:** every identifier in this section belongs to the current
> accounts. To move them, follow [`MIGRACION.md`](./MIGRACION.md).

---

## 3. Cron

- [ ] `vercel.json` declares exactly **one** cron:
      ```json
      { "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
      ```
      (daily, 08:00 UTC)
- [ ] It appears in *Vercel → Settings → Cron Jobs* after the first production
      deployment
- [ ] `CRON_SECRET` is set, and the endpoint rejects an unauthenticated call
- [ ] `/api/health/cron` reports the monitored pg_cron jobs as fresh (not stale)

Any document claiming more crons in `vercel.json` is out of date.

---

## 4. Supabase

- [ ] Project ref `txdyijyswpsalqnwfopc` (or the destination project when
      migrating)
- [ ] All migrations applied — `supabase/migrations/`, **114 files** as of
      2026-09-09:
      ```bash
      supabase link --project-ref txdyijyswpsalqnwfopc
      supabase db push
      ```
- [ ] Schema changes go **only** through versioned migration files. Never raw
      SQL, never `execute_sql`, against the remote project.
- [ ] RLS is enabled on every table in `public`, with policies:
      ```sql
      select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
      select tablename, policyname from pg_policies where schemaname='public' order by 1;
      ```
- [ ] Auth redirect / site URLs point at the production domain
- [ ] Permissions sanity check — `org_role` and RBAC are **separate systems**:
      `organization_members.org_role` gates the admin panel, while the RLS
      policies governing content mutations read `role_assignments`. A user with
      `org_role='admin'` and no `role_assignments` row cannot create tasks:
      ```sql
      select om.user_id, om.org_role, count(ra.id) as rbac_roles
      from organization_members om
      left join role_assignments ra on ra.user_id = om.user_id
      group by om.user_id, om.org_role;
      ```

---

## 5. External services

| Service | Check | Required? |
|---|---|---|
| Supabase | Project reachable, migrations applied, RLS on | Yes |
| Vercel | Project builds, domain assigned, cron registered | Yes (or equivalent host) |
| GitHub | `main` is the deploy source | Yes |
| Resend | API key valid **and sender domain verified** | Yes, for notifications |
| Upstash Redis | One REST URL/token pair configured | Yes, for real rate limiting |
| Sentry | DSN set (optional; unset today — no error tracking) | No |
| Google Cloud | OAuth client + Picker key; **redirect URI matches the live domain exactly** | No (only for Drive/Calendar/Gmail) |

---

## 6. Pre-deployment gate

All four must pass locally — there is **no CI pipeline** in this repository:

```bash
npx tsc --noEmit      # type check (no dedicated npm script)
npm run lint
npm test              # expected: 15 suites, 215 tests passing
npm run build
```

- [ ] `.env.local` is not staged; `.gitignore` still excludes every `.env*`
      except `.env.example`
- [ ] No secret values added to any tracked file (docs included)
- [ ] `curl -s https://task.conto.ec/api/health` returns `"status":"ok"` before
      you deploy, so a post-deploy failure can be attributed correctly

---

## 7. Post-deployment

- [ ] `/api/health` returns 200 with `"status":"ok"`
- [ ] `/api/health/cron` shows no stale jobs
- [ ] Sign in; the Kanban board loads
- [ ] Create / move / comment on a task
- [ ] `/admin` opens as owner and lists users
- [ ] A notification email arrives (validates Resend end-to-end)
- [ ] If Google integrations are in use, `/admin/integraciones` still connects

---

## Note on this document's history

Before 2026-09-09 this checklist described a "TaskFlow Notification System"
built on Slack alerting, PagerDuty escalation, Twilio SMS, Datadog dashboards,
a BullMQ/Redis worker and Gmail service accounts, and listed GDPR
export/deletion endpoints as pending blockers. None of that exists in this
codebase; it was a generic boilerplate. Related historical artifacts —
`BLOCKERS_RESOLUTION.md`, `BLOCKERS_FIXED.md`, `VALIDATION_REPORT.md`,
`docs/PRODUCTION_READINESS_CHECKLIST.md`, `verify-blockers-fixed.sh` — are kept
for the record only and are not part of any current procedure.
