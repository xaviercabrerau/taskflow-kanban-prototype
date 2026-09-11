# Security Checklist — API Endpoints

**Last verified against the code:** 2026-09-10. Every row below was produced by
opening the corresponding `src/app/api/**/route.ts` and reading its actual
authentication and authorization code.

This checklist covers **all 31 route files** that exist in `src/app/api`. If an
endpoint is not listed here, it does not exist in this repository. For request
and response shapes, see [`API_ENDPOINTS.md`](./API_ENDPOINTS.md); this document
is only about *who is allowed to call what*.

> **Migration note:** the production host (`https://task.conto.ec`), the Supabase
> project ref (`txdyijyswpsalqnwfopc`) and the Vercel project IDs belong to the
> current account. The secrets named here (`CRON_SECRET`, `INTERNAL_NOTIFY_SECRET`,
> `JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) must all be regenerated on a move —
> see [`MIGRACION.md`](../MIGRACION.md). Only variable *names* appear in this
> document; never paste a value here.

---

## Auth schemes in use

| Scheme | How it is enforced | Where |
|---|---|---|
| **Supabase session** | `createClient()` from `src/lib/supabase/server.ts` reads the auth cookie; `supabase.auth.getUser()` must succeed, else `401`. | `/api/admin/*`, `/api/tasks/*`, `/api/share-links/*`, `/api/integrations/google/*` |
| **Session + `org_role = 'owner'`** | The above, plus a lookup on `organization_members` that must return `org_role === "owner"`, else `403`. | most write-side admin routes |
| **Personal access token (PAT)** | `Authorization: Bearer tfmcp_...`. The route only checks prefix/length; the token is *actually* validated inside the `mcp_*` SECURITY DEFINER RPCs in Postgres. | `/api/v1/*`, `/api/mcp` |
| **Shared secret (cron)** | `Authorization: Bearer <CRON_SECRET>` compared with `timingSafeEqual`; falls back to `?secret=<CRON_SECRET>` when no header is present. | `/api/cron/alert-check` |
| **Shared secret (internal)** | `x-internal-secret: <INTERNAL_NOTIFY_SECRET>` header, `timingSafeEqual`. Called by Postgres triggers via `net.http_post`. | `/api/internal/*` |
| **Signed OAuth state** | HMAC-signed `state` JWT (`JWT_SECRET`) via `verifyOAuthState`, *plus* a check that the finishing session is the same user. | `/api/integrations/google/callback` |
| **Share token** | No user auth. The opaque token is resolved by `resolve_share_link` / `add_share_link_comment` (SECURITY DEFINER), which enforce scope, permission and expiry. | `/api/public/share/[token]*` |
| **None** | Public by design. | `/api/health`, `/api/health/cron` (see finding SEC-1) |

**Important:** a valid Supabase session is *not* permission to mutate content.
`organization_members.org_role` and the RBAC system are **separate**. Content
mutations are gated by RLS policies that call `has_permission(board_id, ...)`,
which reads `role_assignments` — not `org_role`.

---

## Endpoint matrix

Legend: ✅ verified adequate · ⚠️ verified, with a caveat worth knowing · 🔓 effectively unauthenticated

### Admin (`/api/admin`)

| Endpoint | Method | Auth verified in code | Extra checks | Status |
|---|---|---|---|---|
| `/api/admin/users` | GET | Session | Any member of an org (no owner check) — returns only that org's members | ✅ |
| `/api/admin/users` | POST | Session + `org_role = 'owner'` | Creates via service-role `auth.admin.createUser` | ✅ |
| `/api/admin/users/[id]` | GET | Session | Membership required; target must be in the caller's org | ✅ |
| `/api/admin/users/[id]` | PUT | Session + `org_role = 'owner'` | Name changes use a service-role client (RLS `profiles_update_own` blocks editing another user) | ✅ |
| `/api/admin/users/[id]` | DELETE | Session + `org_role = 'owner'` | Guards against removing the last owner/admin | ✅ |
| `/api/admin/create-user` | POST | Session + `org_role = 'owner'` | Service-role `auth.admin.createUser`, then inserts the membership row | ✅ |
| `/api/admin/link-existing-user` | POST | Session + `org_role = 'owner'` | Service-role `listUsers` paging to find by email | ✅ |
| `/api/admin/reset-password` | POST | Session + `org_role = 'owner'` | Also verifies the target user belongs to the caller's org before `updateUserById` | ✅ |
| `/api/admin/notification-preferences` | GET, PATCH | Session | Reads/writes only rows scoped to `user_id` + the caller's `organization_id` | ⚠️ SEC-4 |
| `/api/admin/import-tasks` | POST | Session + `org_role = 'owner'` | Also verifies the target board belongs to the caller's org (`403`); file capped at 500 data rows | ✅ |
| `/api/admin/import-tasks/template` | GET | Session only | **No owner check.** Returns a static `.xlsx` with headers + one fake example row; contains no tenant data | ⚠️ SEC-3 |

### Cron and health

| Endpoint | Method | Auth verified in code | Status |
|---|---|---|---|
| `/api/cron/alert-check` | GET | `CRON_SECRET` via `Authorization: Bearer`, `timingSafeEqual`; `?secret=` query fallback only when the header is absent | ⚠️ SEC-2 |
| `/api/health` | GET | **None** — by design. Reads one row from `permissions`, a global catalog whose RLS `qual = true`. Leaks no tenant data | ✅ |
| `/api/health/cron` | GET | Forwards any `Authorization` header to Supabase, but `get_cron_health()` was later granted to `anon`, so the endpoint answers with no header at all | 🔓 SEC-1 |

### Integrations

| Endpoint | Method | Auth verified in code | Status |
|---|---|---|---|
| `/api/integrations/google/connect` | GET | Session + `org_role = 'owner'` | ✅ |
| `/api/integrations/google/callback` | GET | Signed `state` (`JWT_SECRET`) **and** `auth.getUser().id === state.userId` | ✅ |
| `/api/gmail-webhook` | POST | Returns `501` unconditionally — not implemented, processes nothing | ✅ |
| `/api/webhooks/gmail-reply` | POST | Returns `501` unconditionally — deliberately disabled until Pub/Sub signature verification exists | ✅ |
| `/api/mcp` | POST | Rate limit first; `initialize` / `tools/list` are open (no secrets returned), `tools/call` requires a `tfmcp_` bearer token validated inside the RPC | ✅ |

### Internal (Postgres trigger → app)

| Endpoint | Method | Auth verified in code | Status |
|---|---|---|---|
| `/api/internal/notify-event` | POST | `x-internal-secret` == `INTERNAL_NOTIFY_SECRET`, `timingSafeEqual`; `401` if the env var is unset | ✅ |
| `/api/internal/sync-calendar-event` | POST | Same pattern | ✅ |

### Public sharing

| Endpoint | Method | Auth verified in code | Status |
|---|---|---|---|
| `/api/public/share/[token]` | GET | None (public by design). Rate-limited on a SHA-256 hash of the token; `resolve_share_link` enforces validity/expiry | ✅ |
| `/api/public/share/[token]/comment` | POST | None (public by design). Rate-limited; `add_share_link_comment` rejects unless the link is `scope=task` + `permission=comment`. Body capped at 4000 chars, guest name at 80 | ✅ |
| `/api/share-links` | GET, POST | Session; POST is additionally rate-limited per user | ✅ |
| `/api/share-links/[id]` | DELETE | Session only — the org-ownership check is delegated entirely to the RLS policy `public_share_links_all` | ⚠️ SEC-5 |

### Tasks

All of these require a Supabase session, apply a per-user rate limit, and then
verify the task belongs to an organization the caller is a member of.

| Endpoint | Method | Auth verified in code | Status |
|---|---|---|---|
| `/api/tasks/[id]/drive-attachment` | POST | Session + rate limit + org boundary check | ✅ |
| `/api/tasks/[id]/forward-email` | POST | Session + rate limit + org boundary check | ✅ |
| `/api/tasks/[id]/github-link` | POST | Session + rate limit | ✅ |
| `/api/tasks/[id]/schedule-meeting` | POST | Session + rate limit + org boundary check | ✅ |
| `/api/tasks/[id]/summarize-comments` | POST | Session + rate limit | ✅ |
| `/api/tasks/parse-natural-language` | POST | Session + rate limit + explicit org membership check (`403`) | ✅ |

### Public REST API v1

All three routes go through `authenticateApiRequest` in `src/lib/api-v1/auth.ts`:
bearer token must start with `tfmcp_` and be ≥ 20 chars, then a rate-limit check
keyed on the SHA-256 of the token, then the `mcp_*` SECURITY DEFINER RPC does the
real token validation and tenant scoping.

| Endpoint | Method | Status |
|---|---|---|
| `/api/v1/tasks` | GET, POST | ✅ |
| `/api/v1/tasks/[id]/comments` | POST | ✅ |
| `/api/v1/tasks/[id]/move` | POST | ✅ |

---

## Open findings

These are **documentation findings**, recorded here for the maintainer to decide
on. Nothing in the code was changed while producing this checklist.

### SEC-1 — `/api/health/cron` is effectively unauthenticated

The handler forwards the caller's `Authorization` header to Supabase, which reads
as an auth boundary, but migration `20260810235939_grant_cron_health_to_anon.sql`
granted `anon` EXECUTE on `get_cron_health()` so that the `CRON_SECRET`-gated
`/api/cron/alert-check` could use it. As a side effect, `/api/health/cron` now
answers to anyone with no header at all.

- **Exposure:** whether four hardcoded, non-secret pg_cron job names are stale,
  their last run timestamp and status. No tenant data.
- **In-code status:** explicitly documented in the route as an accepted tradeoff.
- **If you want it closed:** revoke the `anon` grant and give `/api/cron/alert-check`
  its own path to the data, or gate this route on `CRON_SECRET` too.

### SEC-2 — `CRON_SECRET` accepted as a URL query parameter

`/api/cron/alert-check` falls back to `?secret=<CRON_SECRET>` when no
`Authorization` header is present. The comparison is timing-safe and exact, but a
secret in a query string ends up in Vercel access logs, browser history and any
intermediary proxy log.

- **Why it exists:** free-tier uptime monitors often cannot send custom headers.
- **Mitigation if kept:** treat `CRON_SECRET` as log-exposed, rotate it on any
  log-access incident, and prefer the header path wherever possible.

### SEC-3 — `/api/admin/import-tasks/template` requires a session but not ownership

Any authenticated user of any organization can download the import template,
while the page that uses it (`/admin/importar-tareas`) and the import endpoint
itself are owner-only. The template is static (column headers plus a fictional
example row) and contains no tenant data, so the impact is cosmetic — but the
authorization level is inconsistent with the rest of the import feature.

### SEC-4 — membership lookups do not filter by organization

Several admin routes resolve the caller's membership with
`.from("organization_members").select(...).eq("user_id", ...).maybeSingle()` and
no `organization_id` filter. `organization_members` has
`UNIQUE(organization_id, user_id)`, so a user who belongs to **two** organizations
matches two rows and `maybeSingle()` errors — the caller gets `500` or `403`
instead of their data. This is a correctness/lockout bug rather than a privilege
escalation (it fails closed), but it will surface the first time a user is added
to a second organization.

### SEC-5 — `/api/share-links/[id]` DELETE relies solely on RLS

The route checks only that a session exists and then calls `revokeShareLink(supabase, id)`.
Authorization is entirely the `public_share_links_all` RLS policy. That policy is
the real boundary and it does scope to org members, so this is defence-in-depth
rather than a hole — but the route has no second check, and it returns the raw
error `message` in its `500` body, which can leak Postgres error text (every other
route in the project uses a generic message for exactly this reason).

---

## What this document no longer claims

Earlier revisions of this file tracked three endpoints — `/api/admin/delete-user`,
`/api/admin/export-data` and `/api/admin/audit-logs` — as "planned, CRITICAL, GDPR
required", with request/response schemas and delivery timelines. **None of them
exist in the codebase, and none is scheduled.** They have been removed rather than
carried forward, so this checklist reflects only what is real. If GDPR erasure and
portability endpoints are wanted, they are new work, not pending work.

Audit logging, however, **does** exist in a different form — see
[`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md) — via database-level audit tables and the
`/admin/auditoria` page, not via an `/api/admin/audit-logs` HTTP endpoint.

---

## Verifying this checklist yourself

```bash
# every route file that exists
find src/app/api -name route.ts | sort

# what each one actually checks
grep -n "getUser\|org_role\|CRON_SECRET\|INTERNAL_NOTIFY_SECRET\|checkRateLimit\|401\|403" \
  src/app/api/<path>/route.ts
```

The shell scripts under `testing/` (`2-security-testing.sh` and friends) are
manually-run probes against a deployed URL, not part of `npm test`. Their
"Compliance Testing" section still probes the three non-existent GDPR endpoints
above and will keep reporting `404` — that is expected, not a regression.

---

**Related:** [`API_ENDPOINTS.md`](./API_ENDPOINTS.md) ·
[`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md) ·
[`PRODUCTION_READINESS_CHECKLIST.md`](./PRODUCTION_READINESS_CHECKLIST.md) ·
[`MIGRACION.md`](../MIGRACION.md)
