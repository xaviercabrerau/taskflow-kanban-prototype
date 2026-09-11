# API Endpoints Reference

**Last verified against the code:** 2026-09-09 (every route below was read from its
`src/app/api/**/route.ts` file).

This file documents **every** route handler that exists in `src/app/api`. There are
**31 route files**. If a route is not listed here, it does not exist.

> **Migration note:** the production host used in the examples (`https://task.conto.ec`)
> belongs to the current account. If the project moves to another GitHub/Vercel/Supabase
> account, see [`MIGRACION.md`](../MIGRACION.md).

## Authentication models

The API does not have one single auth scheme. Five different ones are in use:

| Scheme | Used by | How it works |
|---|---|---|
| **Supabase session** | `/api/admin/*`, `/api/tasks/*`, `/api/share-links/*`, `/api/integrations/google/*` | Server-side `createClient()` from `src/lib/supabase/server.ts` reads the Supabase auth cookie. `supabase.auth.getUser()` must succeed, else `401`. |
| **Personal access token (PAT)** | `/api/v1/*`, `/api/mcp` | `Authorization: Bearer tfmcp_...`, issued by `create_mcp_session` and managed in `/admin/api-keys`. Validated inside the `mcp_*` SECURITY DEFINER RPCs, not in the route. |
| **Shared secret (cron)** | `/api/cron/alert-check` | `Authorization: Bearer <CRON_SECRET>`, or `?secret=<CRON_SECRET>` for monitors that cannot send headers. Compared with `timingSafeEqual`. |
| **Shared secret (internal)** | `/api/internal/*` | `x-internal-secret: <INTERNAL_NOTIFY_SECRET>` header. Called by Postgres triggers via `net.http_post`, never from the browser. |
| **None (public)** | `/api/health`, `/api/public/share/[token]*` | Rate-limited; the share routes authorize via the share token itself inside SECURITY DEFINER RPCs. |

**Important:** a valid Supabase session is *not* the same as permission to mutate data.
Content mutations go through RLS policies that call `has_permission(board_id, 'task.create')`,
which reads `role_assignments` — **not** `organization_members.org_role`. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md#org_role-vs-rbac-two-separate-systems).

---

# Admin (`/api/admin`)

All admin routes use the Supabase session. Most also require `org_role = 'owner'` on
the caller's `organization_members` row.

## `GET /api/admin/users`

List all members of the caller's organization.

- **Auth:** Supabase session.
- **Permission:** any member of an organization (no owner check).
- **Parameters:** none.
- **Response `200`:**
  ```json
  {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "admin",
        "status": "active",
        "lastLogin": null,
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
        "assignedClientIds": []
      }
    ]
  }
  ```
  `role` is derived: `org_role` `owner`/`admin` → `"admin"`, anything else → `"user"`.
  `status`, `lastLogin` and `assignedClientIds` are **hardcoded placeholders** — they are
  not backed by any column.
- **Errors:** `401` not authenticated · `403` caller is not in any organization · `500` DB error.
- **Implementation note:** members and profiles are fetched in two separate queries.
  A PostgREST embed (`profiles:user_id(...)`) is impossible here — both
  `organization_members.user_id` and `profiles.id` reference `auth.users`, so there is no
  direct FK between them and the embed fails with "Could not find a relationship".

## `POST /api/admin/users`

Create a real Supabase Auth account, add it to the caller's organization, and grant it
the RBAC role **"Contribuyente"** on every board of the tenant.

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'`.
- **Requires:** `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL`.
- **Body:**
  ```json
  { "email": "newuser@example.com", "name": "John Doe", "role": "admin", "clientIds": [] }
  ```
  - `email` — **required**.
  - `name` — optional; written to `profiles.full_name` with the service-role client.
  - `role` — optional, defaults to `"user"`. Mapped to `org_role`:
    `admin`→`admin`, `viewer`→`guest`, anything else→`member`.
  - `clientIds` — **accepted and ignored.** It has no equivalent in TaskFlow's data model
    (leftover from generic scaffolding).
- **What it actually does:**
  1. `auth.admin.createUser()` with a generated temporary password, `email_confirm: true`
     and `user_metadata.must_change_password = true`.
  2. Inserts the `organization_members` row.
  3. Updates `profiles.full_name` if `name` was given.
  4. Looks up the system role `Contribuyente` and inserts one `role_assignments` row **per
     board** of the tenant (`scope_type: "board"`). Without this the new user would be
     read-only under RLS regardless of their `org_role`.
- **Response `200`:**
  ```json
  {
    "id": "new-user-uuid",
    "email": "newuser@example.com",
    "name": "John Doe",
    "role": "admin",
    "status": "active",
    "lastLogin": null,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
    "assignedClientIds": [],
    "password": "aBc12DeF34gH",
    "warning": "optional — present only if the Contribuyente role could not be assigned"
  }
  ```
  The temporary password is returned **once**, in this response only.
- **Errors:** `400` missing email / `createUser` failed · `401` not authenticated ·
  `403` not owner · `500` missing service-role key, or user created but could not be
  added to the organization.

## `GET /api/admin/users/[id]`

- **Auth:** Supabase session. **Permission:** any member; the target must be in the same organization.
- **Parameters:** `id` (path) — target user UUID.
- **Response `200`:** same shape as one entry of `GET /api/admin/users`.
  Note this handler maps only `owner` → `"admin"`; an `org_role = 'admin'` target comes
  back as `"user"` here (inconsistent with the list endpoint, which maps both).
- **Errors:** `401` · `403` caller not in an organization · `404` target not a member of the same organization.

## `PUT /api/admin/users/[id]`

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'`.
- **Parameters:** `id` (path) — target user UUID.
- **Body:** `{ "name": "Updated Name", "role": "admin", "status": "active" }` — all optional.
  `status` is accepted but **not persisted** (no column backs it).
- **Behaviour:**
  - `name` → `profiles.full_name`, written with the **service-role client**. The RLS policy
    `profiles_update_own` restricts UPDATE to `id = auth.uid()`, so an owner editing
    another user's name with the normal client silently updates 0 rows. Requires
    `SUPABASE_SERVICE_ROLE_KEY`.
  - `role` → `organization_members.org_role` (`admin` or `member`), written with the
    **normal client** — the `org_members_update` policy allows an owner to do this.
- **Response `200`:** the refreshed user object.
- **Errors:** `400` invalid body / update failed · `401` · `403` not owner ·
  `500` missing `SUPABASE_SERVICE_ROLE_KEY` (only when `name` is present).

## `DELETE /api/admin/users/[id]`

Removes the `organization_members` row. **Does not delete the Supabase Auth account.**

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'`.
- **Parameters:** `id` (path).
- **Response `200`:** `{ "id": "uuid" }`
- **Errors:** `400` DB error · `401` · `403` not owner ·
  `409` target is the only remaining `admin`/`owner` in the organization.

## `POST /api/admin/create-user`

Creates an account with an **explicit** password (as opposed to `POST /api/admin/users`,
which generates one) and optionally assigns a chosen RBAC role.

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'`. Requires `SUPABASE_SERVICE_ROLE_KEY`.
- **Body:**
  ```json
  {
    "email": "newuser@example.com",
    "password": "SecurePass123",
    "fullName": "Jane Doe",
    "orgRole": "member",
    "roleId": "optional-role-uuid",
    "requirePasswordChange": true
  }
  ```
  - `email`, `password` — required; password min. 8 characters.
  - `orgRole` — must be `"admin"` or `"member"` if present (validated; other values → `400`).
    Defaults to `"member"`.
  - `roleId` — optional RBAC role. Validated against `roles` where
    `tenant_id = <org>` OR `tenant_id IS NULL` (system roles). If valid, one
    `role_assignments` row is inserted per board of the tenant.
  - `requirePasswordChange` — defaults to `true`; sets `user_metadata.must_change_password`.
- **Response `200`:** `{ "ok": true, "userId": "uuid", "warning": "optional" }`
- **Errors:** `400` invalid body / password too short / email already exists / role not in org ·
  `401` · `403` not owner · `500` missing service-role key or membership insert failed.

## `POST /api/admin/link-existing-user`

For an email that already has a Supabase Auth account but belongs to no organization
(typically an abandoned signup that makes `create-user` fail).

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'`. Requires `SUPABASE_SERVICE_ROLE_KEY`.
- **Body:** same shape as `create-user`. Here `password` is **optional** (min. 8 chars if
  given); when present it is reset and `must_change_password` is set from
  `requirePasswordChange`.
- **Lookup:** `auth.admin` has no "find by email", so `listUsers()` is paginated
  (200/page, up to 20 pages ≈ 4 000 accounts) and filtered in memory.
- **Response `200`:** `{ "ok": true, "userId": "uuid", "warning": "optional" }`
- **Errors:** `400` invalid body / password too short / `updateUserById` failed ·
  `401` · `403` not owner · `404` no account with that email ·
  `409` already a member of your organization, or of another one · `500` missing key / DB error.

## `POST /api/admin/reset-password`

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'`. Requires `SUPABASE_SERVICE_ROLE_KEY`.
- **Body:** `{ "userId": "uuid", "password": "NewPassword123", "requirePasswordChange": true }`
  — `userId` and `password` required, password min. 8 characters.
- **Cross-tenant guard:** the target's `organization_members.organization_id` must equal
  the caller's. Without this check any owner could reset any account in the whole system.
- **Response `200`:** `{ "ok": true }`
- **Errors:** `400` invalid body / password too short / update failed · `401` ·
  `403` not owner, or target not in the caller's organization · `404` user not found ·
  `500` missing key / DB error.

## `GET /api/admin/notification-preferences`

- **Auth:** Supabase session. **Permission:** any member (own preferences only).
- **Response `200`:** grouped by event type, ordered by the canonical event order:
  ```json
  {
    "data": [
      {
        "eventType": "task_assigned",
        "preferences": [
          { "channel": "email", "enabled": true,
            "createdAt": "...", "updatedAt": "..." }
        ]
      }
    ]
  }
  ```
- **Errors:** `401` · `403` caller not in an organization · `500`.

## `PATCH /api/admin/notification-preferences`

Upsert (not single-field patch) of the caller's own preferences.

- **Auth:** Supabase session.
- **Body:** validated with zod —
  ```json
  { "preferences": [ { "eventType": "task_assigned", "channel": "email", "enabled": false } ] }
  ```
  1–16 items. `eventType` ∈ the 8 event types; `channel` ∈ `email` | `in_app`.
  Upserted on `user_id,organization_id,event_type,channel`.
- **Response `200`:** the complete refreshed set, same shape as `GET`.
- **Errors:** `400` invalid JSON · `401` · `403` · `422` zod validation error
  (`{ "error": "Validation error", "details": [{ "path", "message" }] }`) · `500`.

## `GET /api/admin/import-tasks/template`

Downloads the `.xlsx` import template.

- **Auth:** Supabase session (any signed-in user — the template holds no tenant data).
- **Parameters:** none.
- **Response `200`:** binary `.xlsx`,
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `Content-Disposition: attachment; filename="plantilla-importar-tareas.xlsx"`.
  Sheet `Tareas`, header row from the shared `IMPORT_HEADERS` constant
  (`src/lib/import/task-row.ts`) plus one example row:

  | Título | Estado | Prioridad | Asignado | Etiqueta | Fecha inicio | Fecha vencimiento |
  |---|---|---|---|---|---|---|
  | Enviar propuesta al cliente | To Do | Alta | Ana Torres | ventas | 2026-09-10 | 2026-09-15 |

- **Errors:** `401`.

## `POST /api/admin/import-tasks`

Bulk task import from a spreadsheet. Backs `/admin/importar-tareas`.

- **Auth:** Supabase session. **Permission:** `org_role = 'owner'` **of the board's tenant**.
- **Body:** `multipart/form-data`
  - `file` — `.xlsx`, `.xls` or `.csv`. **Max. 500 rows.**
  - `boardId` — target board UUID.
- **Column mapping** (Spanish headers, from `IMPORT_HEADERS`):

  | Header | Required | Rules |
  |---|---|---|
  | `Título` | yes | non-empty |
  | `Estado` | yes | matched case-insensitively against `board_columns.label` of the target board |
  | `Prioridad` | no | `Baja`/`Media`/`Alta`/`Urgente` → `low`/`medium`/`high`/`urgent`; defaults to `medium` |
  | `Asignado` | no | free text → `tasks.assignee_name` |
  | `Etiqueta` | no | free text → `tasks.tag` |
  | `Fecha inicio` | no | `AAAA-MM-DD`, or an Excel numeric serial date |
  | `Fecha vencimiento` | no | same as above |

- **Partial import:** valid rows are inserted, invalid ones are reported by row number
  (row `1` = the first data row, header excluded). If *no* row is valid, nothing is
  inserted and `{ "created": 0, "errors": [...] }` is returned with `200`.
- **Encoding:** a UTF-8 BOM is detected manually to choose how to decode CSV — with BOM,
  SheetJS's own detection is used; without BOM, `codepage: 65001` is forced. Both paths
  have regression tests.
- **Positioning:** for each destination column the current `MAX(position)` is read once,
  then incremented per row in file order.
- **Response `200`:**
  ```json
  { "created": 12, "errors": [ { "row": 4, "reason": "Título es obligatorio; Prioridad \"Urgentisima\" no reconocida (usa Baja/Media/Alta/Urgente)" } ] }
  ```
- **Errors:** `400` invalid body / missing `file` or `boardId` / unreadable file / more
  than 500 rows · `401` · `403` board not visible to the caller (RLS), or caller is not the
  owner of that tenant · `500` DB error on insert.

---

# Health & cron

## `GET /api/health`

Liveness/connectivity probe, safe for an uptime monitor at any frequency.

- **Auth:** none.
- **Check:** anon-key `SELECT id FROM permissions LIMIT 1`. `permissions` is a global
  catalog whose RLS policy is `qual = true`; any tenant-scoped table would call
  `is_org_member()`, whose EXECUTE was revoked from anon, making the probe report "down"
  on a perfectly healthy database.
- **Response `200`:**
  ```json
  { "status": "ok", "checks": { "supabase": { "ok": true, "latencyMs": 42 } }, "timestamp": "..." }
  ```
- **Response `503`:** `status: "error"` and `checks.supabase.message` with the reason.

## `GET /api/health/cron`

pg_cron job health, via the `get_cron_health()` SECURITY DEFINER RPC.

- **Auth:** none required in practice. The handler forwards any `Authorization` header it
  receives, but the RPC was later granted to `anon` as well
  (`20260810235939_grant_cron_health_to_anon.sql`), so this endpoint is callable with no
  header. Accepted trade-off: it only exposes whether known, non-secret job names are stale.
- **Response `200`:** `{ "status": "ok", "jobs": [ { "jobName", "expectedInterval", "lastRunAt", "lastStatus", "isStale" } ], "timestamp": "..." }`
- **Response `503`:** `status: "degraded"` when any job is stale or failed, or
  `status: "error"` with a `hint` when the RPC itself fails.
- Monitored jobs come from `MONITORED_JOBS` in `src/lib/cron-jobs.ts` and must match
  `get_cron_health()`'s own list: `taskflow_check_due_soon_tasks`,
  `taskflow_execute_due_date_automations`, `taskflow_execute_sla_automations`,
  `taskflow_execute_recurring_tasks`, `purge-expired-audit-logs`,
  `record-daily-metrics-snapshots`, `taskflow_resolve_crm_sync_responses`.

## `GET /api/cron/alert-check`

The only endpoint scheduled in `vercel.json` (`0 8 * * *`, daily 08:00 UTC).

- **Auth:** `Authorization: Bearer <CRON_SECRET>`, or — checked only when the header is
  absent — `?secret=<CRON_SECRET>`. The query fallback exists for free-tier uptime monitors
  that cannot send custom headers. Both use `timingSafeEqual`. No `CRON_SECRET` set → always `401`.
- **Behaviour:** runs the same two checks as `/api/health` and `/api/health/cron`, and
  POSTs a combined `{ text, content }` payload to `ALERT_WEBHOOK_URL` (one body works for
  both Slack and Discord webhooks) if anything is wrong. With no `ALERT_WEBHOOK_URL` it
  logs to `console.error` instead.
- **Response `200`:** `{ "ok": true, "problems": [], "alerted": false, "timestamp": "..." }`
- **Response `503`:** problems were found **and** the alert could not be delivered.
- **Errors:** `401` unauthorized.

---

# Public REST API v1 (`/api/v1`)

Same PATs and same SECURITY DEFINER RPCs as `/api/mcp`, exposed as plain REST for
integrations that do not want to speak JSON-RPC. Auth and rate limiting live in
`src/lib/api-v1/auth.ts`.

- **Auth (all routes):** `Authorization: Bearer tfmcp_...`. The token must start with
  `tfmcp_` and be at least 20 chars, else `401`.
- **Rate limit:** per-token, via `checkRateLimit(deriveRateLimitKey(token))` → `429` when exceeded.
- **Error policy:** raw Postgres errors are logged server-side and never returned. Clients
  get either `"Invalid or expired token."` or
  `"The request could not be completed. Check the parameters and try again."`

## `GET /api/v1/tasks`

- **Backing RPC:** `mcp_list_tasks(p_token)`.
- **Parameters:** none.
- **Response `200`:** `{ "tasks": [ ... ] }` (RPC-shaped rows).
- **Errors:** `400` RPC error · `401` · `429`.

## `POST /api/v1/tasks`

- **Backing RPC:** `mcp_create_task`.
- **Body:** `{ "title": "...", "priority": "low|medium|high|urgent", "due_date": "YYYY-MM-DD", "board_name": "..." }`
  - `title` required, max. 300 characters.
  - `priority` defaults to `"medium"`; `board_name` defaults to the token owner's default board.
- **Response `201`:** `{ "taskId": "uuid" }`
- **Errors:** `400` invalid JSON / missing or oversized title / RPC error · `401` · `429`.

## `POST /api/v1/tasks/[id]/comments`

- **Backing RPC:** `mcp_add_comment`.
- **Parameters:** `id` (path) — task UUID. **Body:** `{ "body": "..." }`, max. 4 000 characters.
- **Response `201`:** `{ "commentId": "uuid" }`
- **Errors:** `400` · `401` · `429`.

## `POST /api/v1/tasks/[id]/move`

- **Backing RPC:** `mcp_move_task`.
- **Parameters:** `id` (path). **Body:** `{ "column_label": "In Progress" }` — required.
- **Response `200`:** `{ "ok": true }`
- **Errors:** `400` · `401` · `429`.

> There is **no** `PATCH /api/v1/tasks/[id]` and no filtering by `external_ticket_id`.
> See the status note in [`plans/2026-09-03-crm-integration-design.md`](./plans/2026-09-03-crm-integration-design.md).

---

# MCP endpoint

## `POST /api/mcp`

JSON-RPC 2.0 MCP server. Same PATs and RPCs as `/api/v1`.

- **Auth:** `Authorization: Bearer tfmcp_...`, required for `tools/call` only.
- **Rate limit:** per token (or per derived key when absent) → JSON-RPC error `-32029` with HTTP `429`.
- **Methods:**
  - `initialize` → `{ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "taskflow-mcp", version: "1.0.0" } }`
  - `notifications/initialized` → HTTP `202`, empty body
  - `tools/list` → the 4 tool definitions
  - `tools/call` → runs a tool
- **Tools:** `list_tasks` (no args) · `create_task` (`title` required; `priority` enum,
  `due_date`, `board_name`) · `move_task` (`task_id`, `column_label`) ·
  `add_comment` (`task_id`, `body`).
- **Validation:** a minimal hand-written validator checks `required`, `typeof` and `enum`
  against each tool's own declared schema before calling the RPC.
- **JSON-RPC errors:** `-32001` missing/invalid bearer token · `-32602` invalid params ·
  `-32601` method not found · `-32603` internal error (also reported to Sentry) ·
  `-32029` rate limited.

---

# Share links

## `GET /api/share-links?boardId=<uuid>`

- **Auth:** Supabase session. Authorization is enforced by the `public_share_links_all`
  RLS policy (organization members only).
- **Parameters:** `boardId` (query) — required.
- **Response `200`:** `{ "links": [ ... ] }` (active, non-revoked links).
- **Errors:** `400` missing `boardId` · `401` · `500`.

## `POST /api/share-links`

- **Auth:** Supabase session. **Rate limit:** per user → `429`.
- **Body:**
  ```json
  { "boardId": "uuid", "scope": "board|task", "permission": "view|comment",
    "taskId": "uuid or null", "expiresAt": "ISO or null", "label": "string or null" }
  ```
  `taskId` is required when `scope = "task"`.
- **Response `200`:** `{ "link": { ... }, "token": "plaintext-token" }`. The token is
  generated and hashed server-side by the `create_share_link` RPC and returned in
  plaintext **only here, once**.
- **Errors:** `400` invalid JSON / missing or invalid `boardId`, `scope`, `permission`,
  `taskId` / RPC rejection · `401` · `429`.

## `DELETE /api/share-links/[id]`

- **Auth:** Supabase session; RLS restricts to the owning organization.
- **Parameters:** `id` (path) — share link UUID.
- **Behaviour:** soft delete (sets `revoked_at`).
- **Response `200`:** `{ "ok": true }` · **Errors:** `401` · `500`.

## `GET /api/public/share/[token]`

- **Auth:** **none** (public). Rate-limited on the token itself, not the (spoofable) IP.
- **Parameters:** `token` (path).
- **Backing RPC:** `resolve_share_link(p_token)` (SECURITY DEFINER).
- **Response `200`:** `{ "data": { ... } }`
- **Errors:** `404` `"Link inválido o expirado."` · `429`.

## `POST /api/public/share/[token]/comment`

- **Auth:** **none** (public). Rate-limited per token.
- **Parameters:** `token` (path). **Body:** `{ "body": "...", "guestName": "..." }` —
  `body` required, max. 4 000 chars; `guestName` optional, truncated to 80 chars,
  defaults to `Invitado` inside the RPC.
- **Backing RPC:** `add_share_link_comment` — rejects the write unless the link is
  `scope=task` **and** `permission=comment`.
- **Response `200`:** `{ "data": ... }`
- **Errors:** `400` invalid JSON / invalid comment / link expired or not comment-scoped · `429`.

---

# Task actions (`/api/tasks`)

These run server-side (rather than the usual direct client→Supabase call) because they
need a secret the browser must never hold: the org's Google token, GitHub PAT, or AI key.

All of them use the Supabase session, are rate-limited per user, and authorize by doing an
**RLS-scoped `SELECT` on `tasks`** — if the caller is not a member of the task's
organization the row is invisible and the route answers `404`.

## `POST /api/tasks/[id]/drive-attachment`

- **Body:** either `{ "shareLink": "https://drive.google.com/..." }` (single file) or
  `{ "fileIds": ["...", "..."] }` (Drive Picker, **max. 25 per request**).
- **Response `200`:**
  - `fileIds` branch → `{ "attachments": [ ... ], "errors": [ { "fileId", "error" } ] }` (partial success)
  - `shareLink` branch → `{ "attachment": { ... } }`
- **Errors:** `400` invalid JSON / empty `fileIds` / more than 25 ids / unrecognised Drive
  link · `401` · `404` task not found · `429` · `500` insert failed · `502` Drive API failure.

## `POST /api/tasks/[id]/forward-email`

Sends a task summary from the org's **connected Gmail account** (not a generic sender),
as multipart/alternative (plain text + the branded `ForwardTaskTemplate`).

- **Body:** `{ "to": "someone@example.com", "note": "optional" }` — `to` is shape-validated
  and rejected if it contains CR/LF (header-injection guard).
- **Response `200`:** `{ "ok": true }`
- **Errors:** `400` invalid JSON / invalid recipient · `401` · `404` · `429` · `502` Gmail send failed.

## `POST /api/tasks/[id]/github-link`

- **Body:** `{ "url": "https://github.com/org/repo/issues/1" }` — required.
- **Behaviour:** fetches the issue/PR with the org's GitHub token and inserts a
  `task_github_links` row (`repo`, `number`, `kind`, `title`, `state`).
- **Response `201`:** `{ "link": { ... } }`
- **Errors:** `400` invalid JSON / missing url · `401` · `404` task not found · `429` ·
  **`501` GitHub not configured for the organization** · `500` insert failed · `502` GitHub API failure.

## `POST /api/tasks/[id]/schedule-meeting`

Creates — or, on a later call for the same task, updates (idempotent by design) — a Google
Meet-enabled Calendar event on the org's connected Google account.

- **Body:** `{ "startTime": "ISO datetime", "durationMinutes": 30, "extraEmails": ["..."] }`
  - `startTime` required and parseable.
  - `durationMinutes` required, **15–240**.
  - `extraEmails` optional, **max. 20**, each shape-validated and CR/LF-rejected.
- **Attendees:** the caller + the task's assignees (`task_assignees` and
  `tasks.assignee_user_id`) + `extraEmails`, de-duplicated.
- **Side effect:** writes `meet_link`, `meet_scheduled_at`, `meet_event_id` onto the task.
- **Response `200`:** `{ "meetLink": "https://meet.google.com/...", "scheduledAt": "ISO" }`
- **Errors:** `400` invalid JSON / bad time / bad duration / too many or invalid emails ·
  `401` · `404` · `429` · `500` task update failed · `502` Calendar API failure.

## `POST /api/tasks/[id]/summarize-comments`

- **Body:** none required (the task id in the path is enough).
- **Behaviour:** reads the task's comments in chronological order and summarizes them with
  the org's configured AI credential (OpenAI or Anthropic, set in `/admin/integraciones`).
- **Response `200`:** `{ "summary": "..." }`
- **Errors:** `401` · `404` task not found · `429` ·
  **`501` no AI credential configured** (callers must treat this as "feature unavailable",
  not a server error) · `500` comments query failed · `502` AI provider failure.

## `POST /api/tasks/parse-natural-language`

- **Body:** `{ "text": "...", "tenantId": "uuid" }` — **both required.**
- **Membership check:** filters `organization_members` by **both** `organization_id` and
  `user_id`. Filtering by org alone returns several rows for an owner (the
  `org_members_select` policy lets owners see every row of their org), which makes
  `.maybeSingle()` fail and produced a spurious `403` for the organization's own owner.
- **Response `200`:** the extracted fields (title / priority / due date).
- **Errors:** `400` invalid JSON / missing `text` or `tenantId` · `401` ·
  `403` no membership in that organization · `429` ·
  **`501` no AI credential configured** · `502` the model could not interpret the text.

---

# Google integration

## `GET /api/integrations/google/connect`

- **Auth:** Supabase session — **redirects to `/login`** (302) instead of returning `401`
  when unauthenticated.
- **Permission:** `org_role = 'owner'`.
- **Behaviour:** builds a signed, short-lived OAuth `state` (`JWT_SECRET`) carrying
  `tenantId` + `userId`, then redirects to Google's consent screen.
- **Responses:** `302` to Google · `403` not an owner ·
  `503` OAuth env vars missing (`GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI`).

## `GET /api/integrations/google/callback`

- **Auth:** the signed `state` **plus** a check that the current session's `user.id`
  matches the `userId` inside it (defence in depth against a replayed callback URL).
- **Parameters (query, from Google):** `code`, `state`, or `error`.
- **Behaviour:** exchanges the code for tokens, fetches the connected email, and stores the
  refresh token through the `upsert_integration` RPC with `provider = 'google'`
  (Vault-backed, same as every other provider).
- **Responses:** always a `302` back to `/` with a marker —
  `?googleConnect=success` · `?googleConnect=denied` (user declined) ·
  `?googleConnect=error` (missing code/state, bad state, session mismatch, no
  `refresh_token`, or exchange failure).

---

# Internal (Postgres-trigger) endpoints

Called by Postgres triggers through `net.http_post`. **Never call these from the browser.**

## `POST /api/internal/notify-event`

- **Auth:** `x-internal-secret` header matching `INTERNAL_NOTIFY_SECRET` (`timingSafeEqual`).
  The trigger side reads the secret from Supabase Vault.
- **Body:** the notification event, plus an optional `channels: ["email"|"in_app"]` array.
  Everything except `channels` is forwarded to `sendNotification()` as the event.
- **Response `200`:** the `sendNotification` result. It is always `200` once authorized and
  parseable — a DB trigger cannot act on a retry — but the body now distinguishes
  "processed" from "rejected at validation", which is exactly what let a payload
  field-name mismatch hide in production until an audit found it.
- **Errors:** `400` invalid JSON · `401` bad or missing secret.

## `POST /api/internal/sync-calendar-event`

- **Auth:** same `x-internal-secret` / `INTERNAL_NOTIFY_SECRET`.
- **Body:** `{ "tenantId", "taskId", "taskTitle", "dueDate": "ISO|null", "taskUrl" }` —
  all required except `dueDate`.
- **Behaviour:** best-effort Google Calendar sync of the task's due date. A Calendar
  failure is logged and swallowed — it must never surface as an error to the trigger,
  which has already committed the real due-date change.
- **Response `200`:** `{ "processed": true }`
- **Errors:** `400` invalid JSON / missing fields · `401`.

---

# Disabled endpoints (return `501`)

Both routes exist so the URL resolves, but neither processes anything.

## `POST /api/gmail-webhook`

`501` — `"gmail_inbound no está configurado todavía. Requiere OAuth + Pub/Sub en un Google
Workspace real."` Needs a real Google Workspace with Domain-Wide Delegation and a Pub/Sub
subscription configured by an administrator outside this app.

## `POST /api/webhooks/gmail-reply`

`501` — blocked until **both** (1) real Pub/Sub message-signature verification (the
`Authorization` JWT must be validated against Google's public keys, not trusted) and
(2) an `email_threads` / `failed_jobs` schema reconciled with the live
`notifications` / `notification_preferences` tables. Without (1) anyone who guessed a
`message_id` could move any task or inject comments with no authentication.

---

# Status codes

| Code | Meaning in this API |
|---|---|
| 200 | Success |
| 201 | Created (`/api/v1` creates, `github-link`) |
| 202 | Accepted, empty body (`notifications/initialized` on `/api/mcp`) |
| 302 | Redirect (Google OAuth routes only) |
| 400 | Validation error, malformed JSON, or a rejected RPC |
| 401 | Missing/invalid session, bearer token, or shared secret |
| 403 | Authenticated but not permitted (usually "not the org owner") |
| 404 | Not found — including "invisible to you under RLS" |
| 409 | Business-rule conflict (last admin, user already in an org) |
| 422 | zod validation failure (notification preferences only) |
| 429 | Rate limit exceeded |
| 500 | Server/DB error, or a required env var is missing |
| 501 | Feature not configured for this organization (AI, GitHub) or globally disabled (Gmail) |
| 502 | An upstream third party failed (Google, GitHub, OpenAI/Anthropic) |
| 503 | Health check failed, or OAuth is not configured |

## Rate limiting

Implemented in `src/lib/rate-limit.ts` on Upstash Redis. It accepts either
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` or the Vercel Marketplace's
`KV_REST_API_URL`/`KV_REST_API_TOKEN` pair. With neither configured it falls back to a weak
in-memory limiter. Session-authenticated routes key the limit **per user**; PAT and public
routes key it per token. Rate-limited routes answer `429` with a JSON `error` message —
they do not emit `X-RateLimit-*` headers.

---

# Examples

```bash
# Session-authenticated admin call (cookie-based; a browser sends this automatically)
curl https://task.conto.ec/api/admin/users \
  -H "Cookie: sb-access-token=...; sb-refresh-token=..."

# Create a user (owner only) — returns the temporary password once
curl -X POST https://task.conto.ec/api/admin/users \
  -H "Cookie: ..." -H "Content-Type: application/json" \
  -d '{ "email": "nuevo@example.com", "name": "Nuevo Usuario", "role": "user" }'

# Download the import template
curl -OJ https://task.conto.ec/api/admin/import-tasks/template -H "Cookie: ..."

# Bulk import
curl -X POST https://task.conto.ec/api/admin/import-tasks \
  -H "Cookie: ..." \
  -F "file=@tareas.xlsx" \
  -F "boardId=<board-uuid>"

# Public REST API v1 with a personal access token
curl https://task.conto.ec/api/v1/tasks -H "Authorization: Bearer tfmcp_..."

curl -X POST https://task.conto.ec/api/v1/tasks \
  -H "Authorization: Bearer tfmcp_..." -H "Content-Type: application/json" \
  -d '{ "title": "Revisar contrato", "priority": "high", "due_date": "2026-09-30" }'

# Health checks
curl https://task.conto.ec/api/health
curl https://task.conto.ec/api/health/cron
```
