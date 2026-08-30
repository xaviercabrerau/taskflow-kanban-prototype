# Wire the 6 remaining notification event types

**Date:** 2026-08-29
**Status:** Approved

## Context

`src/lib/notifications/notify.ts` (`sendNotification()`) already supports
all 8 `EventType`s end-to-end — email via Resend + React Email templates,
plus an in-app `notifications` row. Only 2 of the 8 are actually wired to a
real call site today: `task_mentioned` and `status_changed`, both fired
from Postgres triggers (`notify_comment_mentions`,
`notify_task_status_changed` in
`supabase/migrations/20260828190100_wire_email_notifications_via_triggers.sql`)
that (a) insert the in-app row directly, then (b) call
`net.http_post` → `POST /api/internal/notify-event` with
`channels=['email']` to fire the email side, authenticated via a shared
secret (`internal_notify_secret` in Vault / `INTERNAL_NOTIFY_SECRET` env
var).

This is documented as the required pattern in `notify.ts`'s own header
comment: new event types must be wired via a Postgres trigger calling
`/api/internal/notify-event`, never via a client component or
`BoardContext` action — this keeps RLS as the single authorization
boundary for board/task mutations (client → Supabase direct) while side
effects like email stay server-side.

The 6 unwired event types, per `OBSERVABILITY.md` section 6: `task_assigned`,
`due_soon`, `comment_added`, `project_created`, `member_invited`,
`task_completed`.

## Goal

Wire all 6 remaining event types using the exact same pattern as the two
already in production. No app/client code changes — this is additive SQL
only (new migration file), since every consumer (email templates,
`template-map.tsx`, `notify.ts`, the `/api/internal/notify-event` route)
already exists and already handles all 8 types.

## Non-goals

- Not implementing the per-event default-channel table from
  `docs/NOTIFICATION_SYSTEM_DESIGN.md` (e.g. "`task_completed` defaults to
  OFF for both channels"). Neither of the two already-wired events
  enforces this — `notify.ts`'s `getUserPreferences()` fails open to
  "both enabled" when no preference row exists for a user. Matching that
  existing behavior for consistency; changing it is a separate, unrelated
  piece of work if ever wanted.
- Not touching the Gmail inbound/reply-parsing half — still blocked on a
  real Google Workspace account, out of scope here.
- Not adding new email templates or new `notify.ts` logic — both already
  support all 8 types.

## Design — per event

All six follow the same two-step body as the existing triggers: insert into
`public.notifications` directly (immediate in-app row), then
`perform net.http_post(...)` to `/api/internal/notify-event` with
`channels := jsonb_build_array('email')`, guarded by
`if notify_secret is not null then`.

### 1. `due_soon` — extend existing function, no new trigger

`check_due_soon_tasks()` (runs hourly via `pg_cron` job
`taskflow_check_due_soon_tasks`) already loops over due-soon tasks, inserts
the in-app row, and sets `due_soon_notified_at` to prevent re-notifying.
Add the `net.http_post` call right after the existing insert, inside the
same loop iteration, gated by the same `due_soon_notified_at is null`
condition that already exists. Recipient: `t_rec.created_by` (unchanged).
Data: `taskTitle`, `dueDate` (ISO from `t_rec.due_date`).

### 2. `task_assigned` — new `AFTER INSERT` trigger on `task_assignees`

For `NEW.user_id`, skip if `NEW.user_id = auth.uid()` (self-assignment).
Look up the task (`title`, `tenant_id`) from `NEW.task_id`. Insert in-app
row (`type='task_assigned'`), then fire the webhook with `taskTitle`,
`actorName` (resolved from `profiles.full_name` for `auth.uid()`, falling
back to email).

### 3. `task_completed` — new `AFTER UPDATE` trigger on `tasks`

Fires when `NEW.column_id is distinct from OLD.column_id` AND the new
column's `board_columns.is_done_state = true` AND the old column was not
already a done-state column (guards against re-notifying on a lateral move
between two done columns, if a board ever has more than one). Recipients:
everyone in `task_assignees` for that task, excluding `auth.uid()`. Loops
per assignee like `notify_comment_mentions` does. This is deliberately
separate from `status_changed` (which notifies the *creator* on *any*
column move) — different audience, different trigger condition, no
overlap in practice since one targets the creator and the other targets
assignees.

### 4. `comment_added` — new `AFTER INSERT` trigger on `comments`

Recipients: task creator + all `task_assignees` for `NEW.task_id`, minus
the comment author (`NEW.author_id`), minus anyone already in
`NEW.mentioned_user_ids` (they get `task_mentioned` instead from the
existing `notify_comment_mentions` trigger on the same row — this avoids
double-notifying the same person for the same comment). Data: `taskTitle`,
`actorName`, `commentText` (first 500 chars, matching the mention
trigger's truncation).

### 5. `member_invited` — new `AFTER INSERT` trigger on `organization_members`

Fires when `NEW.org_role != 'owner'`. The only `owner`-role row ever
inserted into this table comes from the atomic org-bootstrap
`SECURITY DEFINER` RPC (`bootstrap.ts` → migration
`m8_atomic_org_creation...`) — a brand-new org's first (owner) membership,
not a real invite. Both real invite paths (`POST /api/admin/create-user`,
`inviteMemberByEmail` in `members-repo.ts`) insert `org_role='member'` or
`'admin'`, so excluding `'owner'` cleanly separates "someone got invited"
from "a new org was created." Recipient: `NEW.user_id`. Actor:
`NEW.invited_by` if set, else `auth.uid()` (the admin-created-user path
sets `invited_by`; `inviteMemberByEmail` currently does not — falling
back to `auth.uid()` covers both without an app-code change). Data:
`actorName`.

### 6. `project_created` — new `AFTER INSERT` trigger on `boards`

Recipients: organization members with `org_role in ('owner', 'admin')` for
`NEW.tenant_id`, excluding the creator (`NEW.created_by`). Deliberately
scoped to owners/admins rather than every org member, to avoid an
org-wide email blast every time a board is created — the recommendation
made and approved during design. Data: `projectName` (from `NEW.name`).

## Migration plan

One new migration file,
`supabase/migrations/<timestamp>_wire_remaining_notification_events.sql`,
containing:
- `create or replace function public.check_due_soon_tasks()` (extended)
- `create function public.notify_task_assigned() returns trigger` +
  `create trigger ... after insert on task_assignees`
- `create function public.notify_task_completed() returns trigger` +
  `create trigger ... after update on tasks` (update-only body,
  matching `notify_task_status_changed`'s existing `if` guard style)
- `create function public.notify_comment_added() returns trigger` +
  `create trigger ... after insert on comments` — added as a *second*
  trigger on `comments`, alongside the existing `notify_comment_mentions`
  trigger, not merged into it (keeps each trigger single-purpose, matches
  how `notify_task_status_changed` and any future per-column trigger stay
  separate on `tasks`)
- `create function public.notify_member_invited() returns trigger` +
  `create trigger ... after insert on organization_members`
- `create function public.notify_project_created() returns trigger` +
  `create trigger ... after insert on boards`

All new functions: `security definer`, `set search_path to 'public'`,
same `vault.decrypted_secrets` lookup for `internal_notify_secret`, same
hardcoded production webhook URL
(`https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event`)
as the existing two triggers — consistent with current precedent
(app URL isn't sensitive; already hardcoded twice).

## Testing / verification

- `npx tsc --noEmit`, `npx jest` — no app code changes expected to affect
  these, but run as a regression check.
- Apply the migration to the remote Supabase project (`supabase db push`
  or `mcp__supabase__apply_migration`), then verify live for at least one
  representative event (e.g. assign a task to another org member, confirm
  the in-app row appears and an email arrives via Resend, no `failed_jobs`
  row) — same live-verification approach already used for the two
  existing triggers and for the Google OAuth connect flow.
- Spot-check `member_invited` via both invite paths (`create-user` and
  `inviteMemberByEmail`) since they differ in whether `invited_by` is set.
- Spot-check `task_completed` doesn't double-fire when a task moves
  between two done-state columns on a board that has more than one (most
  boards only have one "Done" column, but the guard should hold
  regardless).

## Risks / open questions

- None blocking. The `project_created` audience (owners/admins only) was
  the one open question during design — resolved above.
