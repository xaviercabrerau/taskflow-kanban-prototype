# Testing Quick Reference

> **Verified against the code on 2026-09-10.** Current state: **15 suites /
> 215 tests, all passing** (`npm test`, ~1.5s). Consistent with
> [`TESTING.md`](./TESTING.md), which is the full guide — this page is just the
> commands.

---

## The four commands you actually need

```bash
npm test              # jest — run every suite once and exit
npm run test:watch    # jest --watch — re-run affected suites on file change
npm run test:coverage # jest --coverage — coverage report
npx tsc --noEmit      # type check (there is NO npm script for this)
```

`npm run lint` runs ESLint. That is the complete list of test-related scripts in
`package.json`; anything else you may have read elsewhere does not exist.

### Running a subset

```bash
npx jest src/lib/import                     # by path
npx jest -t "BOM"                           # by test name
npx jest src/app/api/admin/users --coverage # one area, with coverage
```

---

## What is actually covered

Jest 29 + ts-jest, `testEnvironment: "node"`, `testMatch: **/__tests__/**/*.test.ts`
under `src/` (see `jest.config.ts`). All 15 suites:

| Suite | Area |
|---|---|
| `src/app/api/admin/import-tasks/__tests__/route.test.ts` | Bulk task import route |
| `src/app/api/admin/notification-preferences/__tests__/route.test.ts` | Notification preferences route |
| `src/app/api/admin/users/__tests__/route.test.ts` | User list/create route |
| `src/app/api/admin/users/__tests__/[id].route.test.ts` | Single-user GET/PUT/DELETE |
| `src/app/api/internal/notify-event/__tests__/route.test.ts` | Internal notify webhook |
| `src/app/api/webhooks/gmail-reply/__tests__/route.test.ts` | Gmail reply endpoint (currently a `501`) |
| `src/lib/emails/__tests__/templates.test.ts` | React Email templates |
| `src/lib/emails/__tests__/utils.test.ts` | Email helpers (incl. `sanitizeForEmail`) |
| `src/lib/google/__tests__/drive.test.ts` | Google Drive helpers |
| `src/lib/google/__tests__/oauth.test.ts` | OAuth state signing (`JWT_SECRET`) |
| `src/lib/import/__tests__/task-row.test.ts` | Import row parsing, incl. UTF-8 BOM regression |
| `src/lib/notifications/__tests__/notify.test.ts` | Notification dispatch |
| `src/lib/services/__tests__/userService.test.ts` | User service layer |
| `src/lib/supabase/__tests__/board-repo.test.ts` | Board repository |
| `src/lib/supabase/__tests__/notifications-repo.test.ts` | Notifications repository |

**Supabase is always mocked.** No test touches a real database, so you do not
need any environment variable, a running dev server, or network access to run
`npm test`.

### What is NOT covered — do not claim otherwise

- **No component or browser tests.** There is no jsdom environment, no React
  Testing Library, no Playwright or Cypress. React components, every page under
  `src/app/**/page.tsx`, and the drag-and-drop board are untested by `npm test`.
- **Only 6 of the 31 API route files have a test.** The other 25 — including all
  of `/api/v1/*`, `/api/mcp`, `/api/cron/alert-check`, `/api/tasks/*` and the
  public share routes — have none.
- **No RLS or migration tests.** The 114 migrations in `supabase/migrations/` are
  not exercised by the suite.
- **No E2E and no CI gate** wired to these tests in this repo.
- `testMatch` only picks up `*.test.ts` — a `*.test.tsx` file would be silently
  ignored.

---

## Manual scripts under `testing/` and `scripts/`

These are **not** part of `npm test`. They are hand-run tools that hit a deployed
or local URL, and several of them are stale — check before trusting output.

| File | Exists | Note |
|---|---|---|
| `testing/2-security-testing.sh` | yes | Its "Compliance Testing" section probes `/api/admin/delete-user`, `/api/admin/export-data` and `/api/admin/audit-logs`, **none of which exist**. Expect permanent `404`s there. |
| `testing/run-load-tests.sh`, `testing/load-test.js`, `testing/1-load-testing.yaml` | yes | k6 scripts. **k6 is not installed as a project dependency**, and the auth model they assume is wrong — see [`LOAD_TEST_SETUP.md`](./LOAD_TEST_SETUP.md). |
| `scripts/generate-test-users.js` | yes | Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. |
| `scripts/generate-test-tokens.js` | yes | Needs `SUPABASE_URL` + `SUPABASE_ANON_KEY`. Produces Supabase JWTs, which the app's cookie-session routes do **not** accept as bearer tokens. |
| `scripts/validate-environment.sh` | yes | Environment variable sanity check. |
| `scripts/test-credentials.sh` | **no** | Referenced by older docs; never existed. Use `validate-environment.sh`. |

The only endpoint safe and meaningful to hammer without auth is `GET /api/health`.

---

## Environment variables

`npm test` needs **none**. The variables below are only for the manual scripts
above:

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
BASE_URL          # e.g. http://localhost:3000, or https://task.conto.ec
```

> Set values in `.env.local` (git-ignored) or your shell — **never** write a key,
> token or DSN into a file in `docs/`. The names above are all this document
> should ever contain.
>
> **Migration note:** `BASE_URL` and the Supabase values belong to the current
> account (project ref `txdyijyswpsalqnwfopc`, host `task.conto.ec`). If TaskFlow
> moves accounts, see [`MIGRACION.md`](../MIGRACION.md).

`SENTRY_ENABLED`, `SENTRY_ENVIRONMENT` and `SENTRY_TRACE_SAMPLE_RATE` appeared in
earlier revisions of this page. **They are not read anywhere in this project.**
Only `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are — see
[`SENTRY_SETUP.md`](./SENTRY_SETUP.md).

---

## Before a deploy

```bash
npm test          # must be 15/15 suites, 215/215 tests
npx tsc --noEmit  # must be clean
npm run lint
npm run build
```

There is no `/api/test-sentry` route to curl, and there are no GDPR endpoints
pending implementation — see
[`SECURITY_ENDPOINTS_CHECKLIST.md`](./SECURITY_ENDPOINTS_CHECKLIST.md).

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Cannot find module '@/...'` | Run jest from the repo root; the `@/` alias comes from `moduleNameMapper` in `jest.config.ts`. |
| A new test file never runs | It must be `src/**/__tests__/**/*.test.ts` — `.tsx` and files outside `src/` are not matched. |
| `429` from a manual script | Rate limiting is real: 30 req/min per caller via Upstash, or 10 req/min in-memory when Upstash is unconfigured. Wait out the window. |
| `401` from a manual script against `/api/admin/*` | Those routes use a Supabase **session cookie**, not `Authorization: Bearer`. A generated JWT will not work. |
| `404` on `/api/events/trigger-notifications` or the GDPR endpoints | Those endpoints do not exist. Expected, not a regression. |

---

**Related:** [`TESTING.md`](./TESTING.md) (full guide) ·
[`API_ENDPOINTS.md`](./API_ENDPOINTS.md) ·
[`SECURITY_ENDPOINTS_CHECKLIST.md`](./SECURITY_ENDPOINTS_CHECKLIST.md) ·
[`LOAD_TEST_SETUP.md`](./LOAD_TEST_SETUP.md) · [`MIGRACION.md`](../MIGRACION.md)

**Last verified against the code:** 2026-09-10
