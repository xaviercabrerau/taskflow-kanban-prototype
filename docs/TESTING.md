# Testing Guide

> **Status: verified 2026-09-09** against the real test suite.
> Current state: **15 suites / 215 tests, all passing** (`npx jest`).

## Overview

The automated test suite is **Jest 29 + ts-jest**, running in the `node` test
environment. It covers the notification pipeline, email templates, the task
import parser, the Google integration helpers, the Supabase repository layer,
and a subset of API route handlers. Supabase clients are always mocked — no
test touches a real database.

There is **no browser/component test runner** (no jsdom, no React Testing
Library, no Playwright/Cypress in the automated suite), so React components,
pages, and drag-and-drop behaviour are **not** covered by `npm test`. The
shell scripts under `testing/` (load and security testing) are separate,
manually-run tools — see `docs/LOAD_TEST_SETUP.md`.

## Running Tests

### Run all tests

```bash
npm test
```

Runs all suites once and exits.

### Watch mode (development)

```bash
npm run test:watch
```

Re-runs affected tests when files change.

### Coverage report

```bash
npm run test:coverage
```

Coverage is collected from `src/**/*.ts` (excluding `*.d.ts` and `__tests__/`),
per `collectCoverageFrom` in `jest.config.ts`.

> Note: these are `npm run test:watch` / `npm run test:coverage`. Only `test`
> itself is a built-in npm alias that works without `run`.

### Type checking

There is no dedicated npm script for type checking. Run the compiler directly:

```bash
npx tsc --noEmit
```

TypeScript errors do **not** fail `npm test`: `ts-jest` is configured without
`diagnostics: false`, but it only type-checks the files a test actually
imports. Run `npx tsc --noEmit` separately before considering a change done.

---

## Test Configuration

`jest.config.ts`:

| Setting | Value |
|---|---|
| `preset` | `ts-jest` |
| `testEnvironment` | `node` |
| `roots` | `<rootDir>/src` |
| `testMatch` | `**/__tests__/**/*.test.ts` |
| `moduleNameMapper` | `^@/(.*)$` → `<rootDir>/src/$1` |

Consequences worth knowing:

- Only files under `src/` are discovered. Tests placed elsewhere are ignored.
- Only `.test.ts` inside a `__tests__/` directory is picked up. A `.test.tsx`
  file would **not** run under the current `testMatch`.

---

## Test Structure

Tests live in `__tests__/` directories next to the code they cover.

```
src/
├── app/api/
│   ├── admin/
│   │   ├── import-tasks/__tests__/route.test.ts
│   │   ├── notification-preferences/__tests__/route.test.ts
│   │   └── users/__tests__/{route.test.ts, [id].route.test.ts}
│   ├── internal/notify-event/__tests__/route.test.ts
│   └── webhooks/gmail-reply/__tests__/route.test.ts
└── lib/
    ├── emails/__tests__/{templates.test.ts, utils.test.ts}
    ├── google/__tests__/{oauth.test.ts, drive.test.ts}
    ├── import/__tests__/task-row.test.ts
    ├── notifications/__tests__/notify.test.ts
    ├── services/__tests__/userService.test.ts
    └── supabase/__tests__/{board-repo.test.ts, notifications-repo.test.ts}
```

---

## What Is Actually Covered

Verified 2026-09-09 by counting `it(...)`/`test(...)` blocks per suite.

### API route handlers

| Suite | Tests | What it covers |
|---|---|---|
| `admin/notification-preferences/__tests__/route.test.ts` | 20 | GET/PATCH preferences, 401/403 paths, validation |
| `admin/users/__tests__/[id].route.test.ts` | 14 | GET/PUT/DELETE by id, owner checks, last-admin protection |
| `admin/users/__tests__/route.test.ts` | 13 | GET list + POST create, auth, owner check, validation |
| `admin/import-tasks/__tests__/route.test.ts` | 6 | Bulk import, CSV BOM/no-BOM regressions, row validation |
| `internal/notify-event/__tests__/route.test.ts` | 6 | `INTERNAL_NOTIFY_SECRET` gate, payload validation |
| `webhooks/gmail-reply/__tests__/route.test.ts` | 1 | Confirms the handler is still a disabled 501 stub |

**Not covered by any route test** (24 of the 31 route files), including:
`/api/v1/*` (public REST API), `/api/mcp`, `/api/cron/alert-check`,
`/api/health`, `/api/health/cron`, `/api/public/share/*`, `/api/share-links*`,
`/api/tasks/*`, `/api/integrations/google/*`, `/api/admin/create-user`,
`/api/admin/link-existing-user`, `/api/admin/reset-password`,
`/api/admin/import-tasks/template`, `/api/internal/sync-calendar-event`.

### Library code

| Suite | Tests | What it covers |
|---|---|---|
| `lib/emails/__tests__/templates.test.ts` | 54 | Rendering of every notification email template |
| `lib/emails/__tests__/utils.test.ts` | 36 | `sanitizeForEmail`, date formatting, helpers |
| `lib/services/__tests__/userService.test.ts` | 22 | User service logic |
| `lib/import/__tests__/task-row.test.ts` | 10 | `IMPORT_HEADERS`, row parsing/validation, BOM handling |
| `lib/notifications/__tests__/notify.test.ts` | 10 | Event validation, dispatch, invalid-type handling |
| `lib/google/__tests__/drive.test.ts` | 7 | Drive helper |
| `lib/supabase/__tests__/board-repo.test.ts` | 6 | Board repository queries |
| `lib/google/__tests__/oauth.test.ts` | 5 | OAuth state signing/verification, token exchange |
| `lib/supabase/__tests__/notifications-repo.test.ts` | 5 | Notifications repository queries |

**Total: 215 tests across 15 suites.**

> No coverage percentage is quoted here on purpose. Run
> `npm run test:coverage` for current numbers rather than trusting a figure
> checked into a document.

---

## Mocking Strategy

Tests mock the Supabase client rather than hitting a database.

### Server client (cookie-based, user session)

```typescript
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: jest.fn() },
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  })),
}));
```

### Service-role client

Routes that need to bypass RLS (`create-user`, `link-existing-user`,
`reset-password`, `users/[id]` PUT) construct their own client via
`createClient` from `@supabase/supabase-js`, so that module is mocked
separately:

```typescript
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      admin: {
        createUser: jest.fn(),
        updateUserById: jest.fn(),
        getUserById: jest.fn(),
        listUsers: jest.fn(),
      },
    },
    from: jest.fn().mockReturnThis(),
  })),
}));
```

> Why both: see the RLS notes below — a normal client silently updates 0 rows
> when a policy blocks it, so tests must model which client a route uses.

---

## Domain Rules Tests Must Respect

These are non-obvious project invariants. A test that contradicts them is
testing the wrong thing:

- **`org_role` and RBAC are separate systems.** `organization_members.org_role`
  (`owner`/`admin`/`member`/`guest`) does not by itself grant granular
  permissions like `task.create`. Real permissions come from `role_assignments`
  (one row per board, `role_id` → `roles`), and RLS policies check
  `role_assignments`, not `org_role`, for content mutations.
- **`profiles` RLS:** `profiles_update_own` restricts UPDATE to
  `id = auth.uid()`. An owner editing *another* user's name must use a
  service-role client; with the normal client the update affects 0 rows and
  throws no error.
- **`organization_members` RLS:** `org_members_update` *does* let an owner
  change another member's `org_role` with the normal client.
- **`organization_members` has `UNIQUE(organization_id, user_id)`** — a user can
  belong to several organizations, so membership queries must filter by
  organization, not by user alone.

---

## Running Specific Tests

```bash
# A single file
npm test -- src/app/api/admin/users/__tests__/route.test.ts

# By test name pattern
npm test -- --testNamePattern="auth"

# Verbose output
npm test -- --verbose

# Debug with the Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## Common Issues

| Error | Cause / fix |
|---|---|
| `Cannot find module '@/...'` | Check `moduleNameMapper` in `jest.config.ts` |
| Test file never runs | It must be `src/**/__tests__/**/*.test.ts` — `.tsx` and files outside `src/` are not matched |
| `Timeout exceeded` | Add `testTimeout` in `jest.config.ts` or fix an unresolved promise |
| Update "succeeds" but changes nothing | An RLS policy blocked it — the route probably needs the service-role client (see above) |
| `Unexpected mock/unmock` | Call `jest.clearAllMocks()` in `beforeEach` |

---

## Continuous Integration

**There is currently no CI pipeline in this repository** — no
`.github/workflows/`, and no pre-commit hooks (no `.husky/`). Tests are run
manually before deploying.

If CI is added later, the minimum useful job is:

```yaml
- run: npm ci
- run: npm test
- run: npx tsc --noEmit
- run: npm run lint
```

---

## Best Practices

1. Test behaviour, not implementation.
2. Use descriptive test names that state the scenario.
3. Mock every external dependency; keep tests isolated.
4. Cover error paths, not just the happy path.
5. Update tests when business logic changes.
6. Keep tests independent of execution order.
7. When adding a route, add a route test — 24 of 31 routes currently have none.

---

## Related Documents

- `docs/TESTING_QUICK_REFERENCE.md` — load/security testing quick reference
- `docs/LOAD_TEST_SETUP.md` — load testing setup
- `docs/SECURITY_ENDPOINTS_CHECKLIST.md` — per-endpoint auth/authorization audit
- `docs/API_ENDPOINTS.md` — API reference
