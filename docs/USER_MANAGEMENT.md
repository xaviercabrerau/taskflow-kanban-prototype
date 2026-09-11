# User Management

**Last verified against the code:** 2026-09-09 (`src/app/api/admin/**/route.ts`,
`src/lib/supabase/members-repo.ts`, `supabase/migrations/`).

How users are created, given permissions, edited and removed in TaskFlow. Full
request/response detail for each endpoint is in
[`API_ENDPOINTS.md`](./API_ENDPOINTS.md); the authorization model behind it is in
[`ARCHITECTURE.md`](./ARCHITECTURE.md#org_role-vs-rbac-two-separate-systems).

---

## 1. The one thing to understand first

**Creating a user is two grants, not one.**

1. `organization_members.org_role` — makes the user a member of the organization and
   determines *administrative* rights (`owner` \| `admin` \| `member` \| `guest`).
2. `role_assignments` — the RBAC system, one row **per board**, that grants *content*
   permissions (`task.create`, `task.update`, …). RLS policies check this, via
   `has_permission(board_id, key)`.

They are **separate systems**. `org_role = 'admin'` does **not** grant `task.create`. A
user created with a membership but no `role_assignments` rows can log in, see the board,
and silently fail to change anything — RLS filters the mutation out with no error.

Every creation path in the codebase therefore writes both. If you add a new one, it must
too.

System roles (seeded, `is_system = true`, `tenant_id = null`):

| Role | Permissions |
|---|---|
| Admin | all |
| Manager | `task.create`, `task.update`, `task.delete`, `board.manage`, `member.invite` |
| Contribuyente | `task.create`, `task.update` |
| Solo Lectura | none (read-only by design) |

---

## 2. Creating users

All creation endpoints require a Supabase session **and** `org_role = 'owner'` on the
caller's `organization_members` row (`403` otherwise), plus
`SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` on the server (`500` otherwise).
They all use a service-role client, because creating an auth account and writing another
user's `profiles` row are impossible with the ordinary RLS-bound client.

### `POST /api/admin/users` — the admin UI path (`/admin/usuarios`)

This is what the "Crear usuario" dialog calls. It:

1. Creates a **real Supabase Auth account** with `auth.admin.createUser()`,
   `email_confirm: true`, and a **server-generated temporary password**, with
   `user_metadata.must_change_password = true`.
2. Inserts the `organization_members` row. The dialog's three roles map to
   `org_role` as: `admin` → `admin`, `viewer` → `guest`, anything else → `member`
   (the column's check constraint only allows `owner`/`admin`/`member`/`guest`).
3. Updates `profiles.full_name` with the service-role client.
4. **Grants the system role "Contribuyente" on every board of the tenant**, by inserting
   one `role_assignments` row per board. This endpoint exposes no RBAC role selector, so
   "Contribuyente" is always the default — without it, nothing the user was just given
   would let them create a task.
5. Returns the generated temporary password in the response body, plus a `warning` field
   if the role assignment could not be written ("…asígnalo manualmente desde Roles y
   permisos").

> Historical note: this endpoint used to *simulate* creation — it generated a password,
> returned `200`, and never called Supabase Auth. Users created from `/admin/usuarios`
> did not exist and login failed with "Invalid login credentials". It now creates the
> account for real. Any documentation describing this endpoint as a stub is obsolete.

### `POST /api/admin/create-user` — explicit password + explicit RBAC role

Same shape, but the caller supplies the password (minimum 8 characters) and may pass a
`roleId`. `orgRole` accepts only `admin` or `member` (`400` otherwise). The `roleId` is
validated to belong to the organization or to be a system role
(`tenant_id = org OR tenant_id IS NULL`) before one `role_assignments` row per board is
inserted. Role-assignment failures come back as `warning`, not as an error — the user is
already created.

### `POST /api/admin/link-existing-user` — attach an account that already exists

For an email that already has a Supabase Auth account (an abandoned signup, or a user
from another organization). It looks the account up by paging
`auth.admin.listUsers({ perPage: 200 })`, optionally sets a new password, inserts the
`organization_members` row, and assigns `role_assignments` exactly as above.
`404` if no account with that email exists; `409` if it is already a member of this
organization.

### `inviteMemberByEmail()` (`src/lib/supabase/members-repo.ts`)

The invite path used from the board UI follows the same rule: membership **plus**
"Contribuyente" on the tenant's boards.

---

## 3. Reading and editing users

| Endpoint | Behavior |
|---|---|
| `GET /api/admin/users` | Lists the caller's organization members. Any member may call it — no owner check. Members and profiles are fetched in **two separate queries**; a PostgREST embed is impossible because `organization_members.user_id` and `profiles.id` both reference `auth.users` with no direct FK between them. `status`, `lastLogin` and `assignedClientIds` in the response are hardcoded placeholders backed by no column. |
| `GET /api/admin/users/[id]` | Single member of the caller's organization. `404` if not a member. |
| `PUT /api/admin/users/[id]` | Owner only. Updating `name` writes `profiles.full_name` **with the service-role client**; updating `role` writes `organization_members.org_role` with the ordinary client. |
| `DELETE /api/admin/users/[id]` | Owner only. Refuses with `409` when the target is the last remaining `owner`/`admin` of the organization. |
| `POST /api/admin/reset-password` | Owner only. Verifies the target belongs to the caller's organization (`403` otherwise), then `auth.admin.updateUserById()`. Minimum 8 characters; optionally sets `must_change_password`. |

### Why name and role behave differently

This asymmetry is the single most confusing thing in this area, and it comes straight
from RLS:

- `profiles` has only `profiles_update_own` (`id = auth.uid()`). An owner editing
  **another** user's name with the ordinary client updates **0 rows and returns no
  error** — the UI would show success while nothing changed. Hence the service-role
  client.
- `organization_members` has `org_members_update using (is_org_owner(organization_id))`.
  An owner **can** update another member's `org_role` with the ordinary client.

---

## 4. Roles UI

`/admin/roles` manages the RBAC side: roles, their permissions, and assignments. Use it
when a user was created outside the flows above, or when a creation endpoint returned
the "no se pudo asignar el rol" warning. Assigning a role there writes the same
per-board `role_assignments` rows.

---

## 5. Error reference

| Status | Cause |
|---|---|
| `400` | Missing/invalid fields; password under 8 characters; invalid `orgRole`; `roleId` not belonging to the organization; Supabase Auth rejected the creation (e.g. email already registered) |
| `401` | No valid Supabase session |
| `403` | Caller is not in any organization, is not `owner`, or the target user belongs to another organization |
| `404` | User/account does not exist |
| `409` | Already a member of this organization; or last-admin deletion refused |
| `500` | `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL` missing, or a database error |

The `500` for a missing service-role key is partial: `GET`/list endpoints keep working,
so the failure looks intermittent. Message: *"El servidor no tiene configurado
SUPABASE_SERVICE_ROLE_KEY…"*.

---

## 6. Known limits

- `link-existing-user` finds accounts by paging `listUsers` at 200 per page — linear in
  the size of the auth user base.
- Several handlers resolve the caller's membership with
  `.eq("user_id", …).maybeSingle()`, which assumes one membership per user.
  `organization_members` is `UNIQUE(organization_id, user_id)`, so a user *can* belong to
  several organizations; that assumption breaks the first time one does.
- Membership data is not cached; every request re-queries it (which is also what makes
  permission changes take effect immediately).

---

## 7. Checklist for new user-management work

- [ ] Filter every query by `organization_id`, not just `user_id`
- [ ] Enforce `org_role = 'owner'` on mutations
- [ ] Write **both** `organization_members` and `role_assignments` when creating a user
- [ ] Use the service-role client for anything touching another user's `profiles` row or
      `auth.users`
- [ ] Handle the missing-service-role-key case explicitly
- [ ] Test with two organizations, and with the last-admin edge case
- [ ] Add tests covering the 401 / 403 / 409 paths

---

## See also

- [`API_ENDPOINTS.md`](./API_ENDPOINTS.md) — per-endpoint request/response reference
- [`ARCHITECTURE.md`](./ARCHITECTURE.md#org_role-vs-rbac-two-separate-systems) — `org_role` vs RBAC, RLS details
- [`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md) — what gets recorded
- [`MIGRACION.md`](../MIGRACION.md) — moving users to another Supabase account
