# TaskFlow - Development Workflow Guide

> **Status: verified 2026-09-10** against `package.json`, the repo layout, git and
> the deployment setup. An earlier version of this document described a workflow
> that does not exist in this project (feature branches + PRs, a job worker, a
> local Redis, an email preview server, `npm run db:*` / `type-check` /
> `test:integration` / `test:e2e` scripts). All of that has been removed — see
> [What this document used to claim](#appendix-what-this-document-used-to-claim).

TaskFlow is a multi-tenant Kanban app: **Next.js 16.3.0 (App Router) + React 19 +
TypeScript + Supabase**, deployed on Vercel at <https://task.conto.ec>.

---

## 1. The npm scripts that actually exist

`package.json` defines exactly seven scripts. There are no others:

```bash
npm run dev            # next dev
npm run build          # next build
npm start              # next start
npm run lint           # eslint
npm test               # jest
npm run test:watch     # jest --watch
npm run test:coverage  # jest --coverage
```

Type checking has **no npm script**. Run the compiler directly:

```bash
npx tsc --noEmit
```

Anything you see documented elsewhere as `npm run db:migrate`, `npm run
type-check`, `npm run format`, `npm run worker:dev`, `npm run test:integration`,
`npm run test:e2e`, `npm run email:preview`, `npm run job:*`, `npm run gmail:*`
**does not exist** and will fail with "Missing script".

---

## 2. Branching and deployment model

**There are no feature branches and no pull requests in this project.** Work
happens directly on `main`, and `main` is deployed straight to production.

The full cycle before every deploy:

```bash
npx tsc --noEmit                      # 1. types must be clean
npm run build                         # 2. production build must succeed
npm test                              # 3. 15 suites / 215 tests must pass
git add -A && git commit -m "..."     # 4. commit
git push origin main                  # 5. push
vercel deploy --prod                  # 6. deploy to production
curl -s https://task.conto.ec/api/health   # 7. verify production is healthy
```

Do not skip steps 1-3. There is **no CI pipeline** in this repository (no
`.github/workflows/`, no git hooks), so these checks only run if you run them.

> **Migration note:** `task.conto.ec`, the Vercel project
> `taskflow-kanban-prototype` (projectId `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`,
> orgId `team_LUyGoTDapYDMjHCRVzQaFiaX`), the GitHub repo
> `xaviercabrerau/taskflow-kanban-prototype` and the Supabase project ref
> `txdyijyswpsalqnwfopc` all belong to the current account. If the project moves
> to another account, see [`../MIGRACION.md`](../MIGRACION.md).

---

## 3. Local setup

```bash
npm install
cp .env.example .env.local   # then fill in real values (never commit .env.local)
npm run dev                  # http://localhost:3000
```

`dev/1-setup-local.sh` exists and is runnable, but it was written for an
architecture this project never adopted: it installs the Supabase CLI, tries to
start a local Supabase stack under Docker, installs `redis-cli` and writes
`REDIS_URL=redis://localhost:6379` into `.env.local`. **The app does not use a
local Redis** — rate limiting and cache go through Upstash over HTTPS
(`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, with `KV_REST_API_URL` /
`KV_REST_API_TOKEN` as the Vercel-provided aliases). Development normally runs
against the hosted Supabase project, not a local one. Prefer `npm install` +
`.env.local` by hand.

### Environment variables the code actually reads

Referenced from `src/`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`
- `JWT_SECRET` (public v1 API), `CRON_SECRET` (Vercel cron),
  `INTERNAL_NOTIFY_SECRET` (internal notification endpoint)
- `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
  `GOOGLE_OAUTH_REDIRECT_URI`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`
- `ALERT_WEBHOOK_URL`
- `NODE_ENV`, `VERCEL_GIT_COMMIT_SHA`

Referenced from configuration outside `src/`: `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `NEXT_RUNTIME`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

Only variable *names* belong in documentation — never their values.

> ⚠️ **`scripts/validate-environment.sh` is out of date and should not be trusted
> as the list of required variables.** It validates a set of variables that this
> project does not use: `DATABASE_URL`, `REDIS_HOST` / `REDIS_PORT` / `REDIS_URL`,
> `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` /
> `GMAIL_SERVICE_ACCOUNT_JSON`, `SLACK_WEBHOOK_URL`, `PAGERDUTY_INTEGRATION_KEY`,
> `PAGERDUTY_BASE_URL`, `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
> `TWILIO_FROM_NUMBER`, `DD_API_KEY` / `DD_APP_KEY` (Datadog),
> `ENABLE_SLACK_NOTIFICATIONS`, `ENABLE_PAGERDUTY_NOTIFICATIONS`,
> `API_ADMIN_TOKEN`, `ALERTS_*`, `ON_CALL_EMAIL`, and more. **Slack, PagerDuty,
> Twilio and Datadog were never integrated in this project.** It also misses
> variables the code does need (`RESEND_API_KEY`, `UPSTASH_*`, `KV_*`,
> `CRON_SECRET`, `INTERNAL_NOTIFY_SECRET`, `GOOGLE_*`, `ALERT_WEBHOOK_URL`).
> The list above, not the script, is the source of truth. Fixing the script is a
> separate task.

---

## 4. Database changes

**Rule: schema changes go only through versioned migration files in
`supabase/migrations/`. Never run loose SQL against the database.** There are
currently **114** migration files.

```bash
# create a new migration (Supabase CLI)
supabase migration new add_something

# edit supabase/migrations/<timestamp>_add_something.sql, then apply it
# to the hosted project and commit the file with your change
```

Notes:

- There is **no `supabase/seed.sql`** in this repo. `supabase/` contains only
  `config.toml` and `migrations/`.
- Make migrations idempotent (`if not exists` / `drop ... if exists`) and include
  the RLS policies for any new table in the same migration.

### Non-obvious domain rules

These trip people up constantly:

- **`org_role` and RBAC are separate systems.**
  `organization_members.org_role` (`owner`/`admin`/`member`/`guest`) does **not**
  by itself grant granular permissions such as `task.create`. Real permissions
  come from `role_assignments` (one row per board, `role_id` → `roles`), and RLS
  policies check `role_assignments`, not `org_role`, for content mutations. The
  system role "Contribuyente" grants `task.create` / `task.update`.
- **`profiles` RLS:** the `profiles_update_own` policy restricts UPDATE to
  `id = auth.uid()`. An owner editing *another* user's name must use a
  service-role client; with the normal client the update affects 0 rows and
  throws no error.
- **`organization_members` RLS:** `org_members_update` *does* allow an owner to
  change another member's `org_role` with the normal client.
- **`organization_members` has `UNIQUE(organization_id, user_id)`** — a user can
  belong to several organizations, so membership queries must filter by
  organization, not by user alone.

---

## 5. Testing

Current state: **15 suites / 215 tests, all passing**, via `npm test`.

The suite is Jest 29 + ts-jest in the `node` environment. Only
`src/**/__tests__/**/*.test.ts` is discovered — there is no jsdom, no React
Testing Library and no Playwright/Cypress, so **components, pages and
drag-and-drop are not covered by `npm test`**. Do not claim a coverage
percentage in documentation; run `npm run test:coverage` for current numbers.

Full details (per-suite counts, mocking strategy, what is *not* covered) live in
[`../docs/TESTING.md`](../docs/TESTING.md). The shell scripts under `testing/`
(load and security testing) are separate, manually-run tools — see
[`../testing/README.md`](../testing/README.md), and note the caveats there about
scripts that reference endpoints this project does not have.

---

## 6. API development

Routes live at `src/app/api/**/route.ts` (App Router). The project currently has
31 route files, grouped as:

- **Admin:** `/api/admin/{create-user, import-tasks, import-tasks/template,
  link-existing-user, notification-preferences, reset-password, users,
  users/[id]}`
- **Cron / health:** `/api/cron/alert-check`, `/api/health`, `/api/health/cron`
- **Integrations:** `/api/integrations/google/{callback,connect}`,
  `/api/gmail-webhook`, `/api/webhooks/gmail-reply`, `/api/mcp`
- **Internal:** `/api/internal/notify-event`, `/api/internal/sync-calendar-event`
- **Public / sharing:** `/api/public/share/[token]`,
  `/api/public/share/[token]/comment`, `/api/share-links`, `/api/share-links/[id]`
- **Tasks:** `/api/tasks/[id]/{drive-attachment, forward-email, github-link,
  schedule-meeting, summarize-comments}`, `/api/tasks/parse-natural-language`
- **Public v1 API:** `/api/v1/tasks`, `/api/v1/tasks/[id]/comments`,
  `/api/v1/tasks/[id]/move`

Pages live at `src/app/**/page.tsx`: `/` (Kanban board), `/dashboard`, `/tabla`,
`/calendario`, `/gantt`, `/login`, `/reset-password`, `/share/[token]`, plus
`/admin` and its sub-pages.

Testing an endpoint locally:

```bash
curl -s http://localhost:3000/api/health | jq .
```

Session auth is cookie-based via `@supabase/ssr`; the public v1 API uses a JWT
signed with `JWT_SECRET`. Rate limiting uses `@upstash/ratelimit` over Upstash
REST — there is no `express-rate-limit` (this is not an Express app).

---

## 7. Cron jobs

`vercel.json` declares exactly **one** cron:

```json
{ "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
```

(daily at 08:00 UTC, guarded by `CRON_SECRET`). Any document claiming more crons
in `vercel.json` is out of date.

---

## 8. Dependency notes you must not "fix"

`xlsx` is installed from the **SheetJS CDN**, not from the npm registry:

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

The npm-registry build has two unpatched HIGH vulnerabilities (prototype
pollution + ReDoS) that SheetJS only fixes on its own CDN. **This is
intentional. Do not change it to `xlsx: ^0.18.5`.**

---

## 9. Debugging

See [`DEBUG_GUIDE.md`](./DEBUG_GUIDE.md) — and read its caveats first: the
`2-debug-utils.sh` script it documents was written for a Postgres-over-
`DATABASE_URL` + local-Redis + job-queue architecture this project does not use,
so most of its commands print mock data.

Practical debugging that works today:

```bash
npm run dev                                # server + client logs in the terminal
curl -i http://localhost:3000/api/health   # headers + body of any route
npx tsc --noEmit                           # type errors
npm test -- --testNamePattern="auth"       # narrow a failing test
```

Errors in production go to Sentry (`@sentry/nextjs`, configured via
`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`). Server logs are in the Vercel
dashboard; database logs in the Supabase dashboard.

---

## 10. Code style

- `npm run lint` (ESLint 9 with `eslint-config-next`). There is **no Prettier**
  in this project — `npm run format` does not exist.
- TypeScript strict mode; fix types rather than reaching for `@ts-expect-error`.
- Follow the conventions of the file you are editing.

---

## Appendix: what this document used to claim

Recorded so nobody re-adds it from an old copy. None of the following exists in
this repository:

| Claim in the old doc | Reality |
|---|---|
| `./dev/setup-local.sh` | The file is `dev/1-setup-local.sh`, and it targets an architecture the project never adopted |
| `npm run db:migrate`, `db:seed`, `db:reset`, `db:shell`, `db:check`, `db:slow-queries` | No such scripts |
| `npm run type-check`, `npm run format`, `npm run format:check`, `npm run lint:fix` | No such scripts (use `npx tsc --noEmit`, `npm run lint`) |
| `npm run test:integration`, `npm run test:e2e`, `npm run test:rls`, `npm run test:email-reply` | No such scripts; no integration/E2E/RLS runner exists |
| `npm run worker:dev`, `worker:start`, `job:*` | There is no job worker and no BullMQ-style queue |
| `npm run dev:services`, `redis:cli`, `redis:check`, `redis:logs`, local Redis on 6379 | Redis is Upstash over HTTPS, not a local server |
| `npm run email:preview`, `email:queue:*`, `email:generate` | No such scripts; emails go out through Resend |
| `npm run gmail:*` (`test`, `scope`, `auth:refresh`, `rate-limits`) | No such scripts |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_FROM` | The Google integration uses `GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI`, etc. |
| Tables `notification_queue`, `email_queue`, `job_logs`, `email_templates`, `email_commands`, `users` | None appear in any migration. Real tables include `notifications`, `notification_preferences`, `email_threads`, `failed_jobs`, `audit_log`, `activity_log`, `profiles` |
| `supabase/seed.sql` | Does not exist |
| Feature branches, PR template, squash-merge, "ensure CI passes" | Work goes directly on `main`; there is no CI |
| Coverage thresholds of 80% enforced | No thresholds are configured; no coverage figure is promised |
| Endpoints `/api/notifications`, `/api/notifications/preferences`, `/api/upload`, `/api/auth/gmail/callback` | Not among the 31 real route files (see Section 6) |
| `app/` at the repo root, `app/emails/`, `next.config.js` | Source lives under `src/`; config is `next.config.ts` |
| "Ask in team Slack channel" | Slack was never integrated in this project |

---

Last updated: 2026-09-10
