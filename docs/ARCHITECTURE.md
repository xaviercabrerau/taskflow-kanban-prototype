# TaskFlow Architecture

**Last verified against the code:** 2026-09-09 (`package.json`, `src/`,
`supabase/migrations/`, `vercel.json`).

TaskFlow is a **multi-tenant Kanban application** built on Next.js (App Router) and
Supabase. The organization (`organizations` row, referred to as *tenant* in the schema)
is the isolation boundary; Postgres Row Level Security is the single authorization
boundary for all board/task data.

> **Migration note:** the concrete account-bound values below (Supabase project ref,
> Vercel project, `task.conto.ec`, the GitHub repo) belong to the current account. If the
> project moves to another GitHub/Vercel/Supabase account, see
> [`MIGRACION.md`](../MIGRACION.md).

---

## 1. Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.3.0 |
| UI | React / React DOM | 19.2.8 |
| Language | TypeScript | 5.x |
| Database / Auth / RLS / Storage | Supabase (`@supabase/supabase-js` / `@supabase/ssr`) | ^2.112.2 / ^0.12.4 |
| Drag & drop | `@dnd-kit/core`, `/sortable`, `/utilities` | ^6.3.1 / ^10.0.0 / ^3.2.2 |
| Error tracking | `@sentry/nextjs` | ^10.70.0 |
| Rate limiting / cache | `@upstash/ratelimit`, `@upstash/redis` | ^2.0.8 / ^1.38.2 |
| Transactional email | `resend`, `react-email` | ^4.0.1 / ^6.9.2 |
| Signed OAuth `state` | `jsonwebtoken` (`src/lib/google/oauth.ts`, `JWT_SECRET`) | ^9.0.3 |
| Spreadsheet import/export | `xlsx` | **SheetJS CDN** (see below) |
| Tests | Jest + ts-jest | 29.x |

**`xlsx` is installed from the SheetJS CDN on purpose:**
`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. The npm-registry build
carries two unpatched HIGH vulnerabilities (prototype pollution + ReDoS) that SheetJS
only fixes in its own CDN distribution. Do not "fix" this by switching it back to
`xlsx: ^0.18.5`.

Test suite status: **15 suites, 215 tests, all passing** (`npm test`).

### Scripts

```
npm run dev            # next dev
npm run build          # next build
npm start              # next start
npm run lint           # eslint
npm test               # jest
npm run test:watch     # jest --watch
npm run test:coverage  # jest --coverage
npx tsc --noEmit       # type check (no dedicated npm script)
```

---

## 2. System layers

### 2.1 Client (React Server/Client Components)

- Pages: `/` (Kanban board), `/dashboard`, `/tabla`, `/calendario`, `/gantt`, `/login`,
  `/reset-password`, `/share/[token]`.
- Admin pages under `/admin`: `api-docs`, `api-keys`, `auditoria`, `automatizaciones`,
  `campos-personalizados`, `carga-trabajo`, `importar-tareas`, `integraciones`,
  `planificacion`, `plantillas`, `portafolio`, `reportes`, `roles`, `seguridad`,
  `tareas-recurrentes`, `usuarios`, `workspaces`.
- **Board and task mutations go client → Supabase directly** (see
  `src/context/BoardContext.tsx`), not through Next.js route handlers. This is
  deliberate: it keeps RLS as the single authorization boundary instead of duplicating
  permission logic in an API tier.

### 2.2 Route handlers (`src/app/api/**/route.ts`)

Route handlers exist for the things RLS cannot do by itself: service-role operations,
external integrations, cron, and the public API. The authoritative list is in
[`API_ENDPOINTS.md`](./API_ENDPOINTS.md) — it documents every one of the 31 route files.
Summary by area:

- **Admin:** `/api/admin/create-user`, `/api/admin/import-tasks`,
  `/api/admin/import-tasks/template`, `/api/admin/link-existing-user`,
  `/api/admin/notification-preferences`, `/api/admin/reset-password`,
  `/api/admin/users`, `/api/admin/users/[id]`
- **Cron / health:** `/api/cron/alert-check`, `/api/health`, `/api/health/cron`
- **Integrations:** `/api/integrations/google/callback`,
  `/api/integrations/google/connect`, `/api/gmail-webhook`,
  `/api/webhooks/gmail-reply`, `/api/mcp`
- **Internal (called by Postgres triggers via `pg_net`):**
  `/api/internal/notify-event`, `/api/internal/sync-calendar-event`
- **Public / sharing:** `/api/public/share/[token]`,
  `/api/public/share/[token]/comment`, `/api/share-links`, `/api/share-links/[id]`
- **Tasks:** `/api/tasks/[id]/drive-attachment`, `/api/tasks/[id]/forward-email`,
  `/api/tasks/[id]/github-link`, `/api/tasks/[id]/schedule-meeting`,
  `/api/tasks/[id]/summarize-comments`, `/api/tasks/parse-natural-language`
- **Public REST API v1 (PAT auth):** `/api/v1/tasks`, `/api/v1/tasks/[id]/comments`,
  `/api/v1/tasks/[id]/move`

### 2.3 Database (Supabase Postgres)

- Supabase project ref: `txdyijyswpsalqnwfopc`.
- **114 versioned migrations** in `supabase/migrations/`.
- **Project rule: schema changes go only through versioned migration files.** Never
  apply loose SQL to the remote database — a change that is not in
  `supabase/migrations/` does not survive a migration to another account.
- Business logic that must not be bypassable lives in `SECURITY DEFINER` Postgres
  functions (`has_permission`, `mcp_*` RPCs, `ingest_webhook_task`,
  `execute_automation_rules`, `purge_expired_audit_logs`, …) rather than in the client.
- Scheduled work runs in two places: `pg_cron` inside Postgres (audit purge, CRM sync
  response resolution, due-soon checks) and **one** Vercel cron (below).

---

## 3. Authorization: the part that surprises everyone

This is the single most important section for anyone new to the project — and the most
common source of "the user exists and can log in, but cannot create a task" bugs.

### `org_role` vs RBAC: two separate systems

TaskFlow has **two independent authorization systems**. They are not layered, and one
does not imply the other.

| | `organization_members.org_role` | `role_assignments` (RBAC) |
|---|---|---|
| Values | `owner` \| `admin` \| `member` \| `guest` | a `role_id` → `roles` (`Admin`, `Manager`, `Contribuyente`, `Solo Lectura`) |
| Granularity | one row per (organization, user) | one row per **board** (or workspace) per user |
| Grants | membership + *administrative* rights on the org (managing users, org settings) | *content* permissions: `task.create`, `task.update`, `task.delete`, `board.manage`, `member.invite` |
| Checked by | route handlers (`org_role !== 'owner'` → `403`) | RLS policies, via `has_permission(board_id, 'task.key')` |

**`org_role` does not grant `task.create`.** A member whose `org_role` is `admin` but
who has no `role_assignments` row is effectively **read-only**: every content mutation
is blocked by RLS, silently, because `has_permission()` returns false.

`has_permission(bid, perm_key)` (`20260807222117_m11_rbac_seed_and_has_permission.sql`,
tightened in `20260816050000_mcp_rpcs_enforce_has_permission.sql`) returns true when:

1. the caller is the **organization owner** of the board's tenant (implicit superadmin), or
2. the caller has a `role_assignments` row whose role carries `perm_key`, scoped either
   to that board (`scope_type = 'board'`, `scope_id = board_id`) or to the board's
   workspace (`scope_type = 'workspace'`, `scope_id = board.workspace_id`).

System roles and their permissions (seeded with `tenant_id = null`, `is_system = true`):

| Role | Permissions |
|---|---|
| Admin | all of them |
| Manager | `task.create`, `task.update`, `task.delete`, `board.manage`, `member.invite` |
| Contribuyente | `task.create`, `task.update` |
| Solo Lectura | none (read-only by design) |

**Practical consequence:** every flow that creates a user must also create the
`role_assignments` rows, or the new user is stuck read-only. `POST /api/admin/users` and
`inviteMemberByEmail()` (`members-repo.ts`) both grant **"Contribuyente" on every board
of the tenant** for exactly this reason. See [`USER_MANAGEMENT.md`](./USER_MANAGEMENT.md).

`my_permissions(board_id)` returns the caller's permission keys for a board so the
frontend can enable/hide actions instead of guessing.

### RLS on `profiles` — owners cannot rename other users with the normal client

```sql
create policy profiles_update_own on profiles for update using (id = (select auth.uid()));
```

`UPDATE` on `profiles` is restricted to the caller's own row. There is **no** owner
exception. An organization owner editing *another* user's `full_name` with the normal
(anon-key, user-session) client gets **0 rows affected and no error** — the update
silently does nothing. Any such flow must use a **service-role client** on the server
(this is what `POST /api/admin/users` and `/api/admin/users/[id]` do).

`profiles_select` (current version in `20260904030000_db_performance_review_fixes.sql`)
is deliberately broader: you can read your own profile, plus the profile of anyone who
shares an organization with you. It is *not* `using (true)` — an earlier version was,
and it leaked profiles across tenants
(`20260816040000_fix_profiles_select_cross_tenant_leak.sql`).

### RLS on `organization_members` — owners *can* update, with the normal client

Consolidated into four non-overlapping policies in
`20260811002139_consolidate_organization_members_policies.sql`:

```sql
select: user_id = (select auth.uid()) or is_org_owner(organization_id)
delete: user_id = (select auth.uid()) or is_org_owner(organization_id)
insert: is_org_owner(organization_id)
update: is_org_owner(organization_id)     -- using + with check
```

So the asymmetry to remember is: **an owner can change another member's `org_role`
through the ordinary client, but cannot change that member's `profiles.full_name`
through it.** Those two edits look identical in the admin UI and behave differently
underneath.

### `organization_members` is per-organization, not per-user

`UNIQUE (organization_id, user_id)` — one row per organization. A user can belong to
several organizations. Any membership query must therefore filter by organization, not
only by user. Note that several current route handlers call
`.eq("user_id", …).maybeSingle()`, which implicitly assumes a single membership; that
assumption holds for today's data but breaks the moment a user joins a second
organization.

### `audit_log` is append-only at the RLS level

Only `SELECT` and `INSERT` policies exist for `audit_log`; with no `UPDATE`/`DELETE`
policies, those commands are denied by default for every application role — append-only
enforced by the database, not by convention. See
[`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md).

---

## 4. Authentication

```
Login (email + password)
    ↓ Supabase Auth
Session cookie (read server-side by @supabase/ssr, src/lib/supabase/server.ts)
    ↓
supabase.auth.getUser()  → 401 if absent/invalid
    ↓
organization_members lookup → organization_id (+ org_role)
    ↓
Route handler: org_role check for admin operations
Database:      RLS + has_permission() for content operations
```

Roles are **not** stored in the JWT. Both `org_role` and RBAC are resolved from the
database on every request/query, so a permission change takes effect immediately without
re-issuing tokens.

Five distinct auth schemes exist across the API (Supabase session, PAT `tfmcp_…`,
`CRON_SECRET`, `INTERNAL_NOTIFY_SECRET`, and public/token-authorized share routes) —
the table in [`API_ENDPOINTS.md`](./API_ENDPOINTS.md#authentication-models) is the
reference.

---

## 5. Core data model

```
organizations (tenant)
├── organization_members  (organization_id, user_id, org_role)   UNIQUE(org, user)
├── workspaces
│   └── boards ──► columns ──► tasks ──► comments, activity_log
├── roles / permissions / role_permissions        (RBAC catalog; system roles tenant_id = null)
├── role_assignments (tenant_id, user_id, role_id, scope_type, scope_id, granted_by)
├── audit_log       (tenant_id, actor_id, source, action, resource_type, resource_id,
│                    ip_address, metadata, created_at)   -- append-only
├── automation_rules / automation_executions
├── integrations    (provider incl. 'crm_generic'; secrets in Supabase Vault)
└── webhooks_inbound

auth.users ──► profiles (id, email, full_name)
notifications / notification_preferences / email_threads / failed_jobs  (per user)
```

`tasks.external_ticket_id` + `tasks.synced_from_crm_at` back the CRM integration
(unique per tenant where not null); see
[`plans/2026-09-03-crm-integration-design.md`](./plans/2026-09-03-crm-integration-design.md).

Integration secrets are never stored in plaintext columns: they live in Supabase Vault
and are read only by `SECURITY DEFINER` accessors (`get_crm_credential`,
`get_github_token`, `get_ai_credential`) whose `EXECUTE` is revoked from `anon` and
`authenticated`.

---

## 6. Scheduled work

**Vercel cron (`vercel.json`) — exactly one job:**

```json
{ "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
```

Daily at 08:00 UTC, authenticated with `CRON_SECRET`. Any documentation claiming more
Vercel crons is out of date.

**`pg_cron` jobs inside Postgres** (see `src/lib/cron-jobs.ts` for the list the health
endpoint expects): `purge-expired-audit-logs` (daily 03:00),
`taskflow_resolve_crm_sync_responses` (every minute), due-soon/SLA checks.
`/api/health/cron` reports their state.

---

## 7. Deployment topology

- **Repo:** `https://github.com/xaviercabrerau/taskflow-kanban-prototype`, branch `main`
  (work and deploys happen directly on `main`).
- **Host:** Vercel project `taskflow-kanban-prototype`
  (`projectId prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`, `orgId team_LUyGoTDapYDMjHCRVzQaFiaX`).
- **Production URL:** `https://task.conto.ec`.
- Procedure and environment variables: [`DEPLOYMENT.md`](./DEPLOYMENT.md) and
  [`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md).

Note that some Postgres triggers embed the production URL as a literal when calling
`net.http_post('https://task.conto.ec/api/internal/notify-event', …)`. Those URLs live
inside migration files and **must be updated by a new migration** if the domain changes
— they are not read from an environment variable.

---

## 8. External services

| Service | Used for | Required |
|---|---|---|
| Supabase | Database, auth, RLS, storage, Vault, `pg_cron` | Yes |
| Vercel | Hosting, deployment, cron | Yes (or equivalent) |
| GitHub | Repository, deployment source | Yes |
| Resend | Outgoing email / notifications | Yes for notifications |
| Upstash Redis | Rate limiting and cache | Yes for rate limiting |
| Sentry | Error tracking | Optional |
| Google Cloud (OAuth) | Drive / Calendar / Gmail integration | Optional |

---

## 9. Conventions for new work

- Schema changes → **a new file in `supabase/migrations/`**, never ad-hoc SQL.
- Content mutations → client → Supabase, authorized by RLS. Do not add a route handler
  that re-implements a permission check RLS already performs.
- Server-side side effects (email, calendar sync) → Postgres trigger →
  `/api/internal/*` with `INTERNAL_NOTIFY_SECRET`, not a client call.
- Anything needing the service role → server-only route handler; never expose
  `SUPABASE_SERVICE_ROLE_KEY` to the browser and never give it a `NEXT_PUBLIC_` prefix.
- Creating a user anywhere → also create its `role_assignments`, or the user is
  read-only.
- Documentation names environment variables; it never contains their values.
