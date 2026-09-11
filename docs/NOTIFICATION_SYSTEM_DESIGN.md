# TaskFlow Notification System + Gmail Integration
## Design Specification

**Version:** 1.0
**Date:** 2026-08-16
**Phase:** Semana 3 Punto 6
**Status (re-verified against the code 2026-09-09):** the *outbound* half is
implemented; the *inbound* half is blocked. This document is the original
design and is kept for context — where it disagrees with the notes below,
the notes are correct. See also
[`OBSERVABILITY.md`](../OBSERVABILITY.md#6-notification-system--email--in-app).

Deviations from this design as originally written:

- **No BullMQ, no queue.** The worker in section 1 was never implemented —
  Vercel serverless cannot host a persistent queue consumer. It is replaced
  by a synchronous best-effort send path, `sendNotification()` in
  `src/lib/notifications/notify.ts`. There is no retry queue; failures are
  recorded in `failed_jobs` and never block the underlying action.
- **All 8 event types are wired** (this superseded the earlier "2 of 8"
  note). `task_mentioned` and `status_changed` were wired in
  `20260828190100_wire_email_notifications_via_triggers.sql`; the remaining
  six in `20260829010000_wire_remaining_notification_events.sql`, corrected
  by `20260830150000_fix_notify_eventtype_and_url_regression.sql`.
- **Events are emitted from Postgres triggers, not from API routes.**
  Triggers call `net.http_post` → `POST /api/internal/notify-event`
  (authenticated with `INTERNAL_NOTIFY_SECRET`). This keeps RLS as the single
  authorization boundary while side effects stay server-side. When wiring
  anything new, follow the same pattern — never call `sendNotification()`
  from a client component or from `BoardContext`.
  Note that these triggers embed `https://task.conto.ec` as a **literal** in
  the migration file; changing the production domain requires a new migration.
- **Email goes through Resend**, not the Gmail API, using the React Email
  templates (`src/lib/emails/`).
- **The inbound reply-parsing half (section 5) does not exist.**
  `/api/webhooks/gmail-reply` returns `501`. It needs a Google Workspace
  account with Domain-Wide Delegation and a Cloud Pub/Sub subscription, which
  do not exist. It previously shipped as a stub with a hardcoded
  `return true` in place of signature verification — disabled rather than
  left exploitable.

---

## Executive Summary

TaskFlow Notification System delivers **8 event types** across **2 channels** (Email + In-App) with **Gmail bidirectional integration** (send + parse replies). Users control preferences per event type. Built on **BullMQ + Vercel KV** for reliable async job processing.

---

## 1. Architecture Overview

### Stack
- **Queue Engine:** BullMQ 3.x + Vercel KV (Redis)
- **Email:** Gmail API + React Email templates
- **Webhooks:** Google Cloud Pub/Sub (Gmail replies)
- **Persistence:** Supabase (4 new tables: notification_preferences, notifications, email_threads, failed_jobs)
- **Monitoring:** Sentry (errors), cron alerts (failed jobs)

### Three Layers

**1) Event Emitter** (API routes)
- Emits events to Redis queue when tasks assigned/mentioned/status changed/due soon/commented/completed, projects created, members invited
- Non-blocking: response to user is immediate

**2) Job Processor (BullMQ Consumer)**
- Consumes events from Vercel KV
- Resolves: who notified? which channels? respect notification_preferences table?
- Renders React Email template → sends via Gmail API
- Creates notification in notifications table (in-app)
- Retry logic: 3x exponential backoff

**3) Gmail Webhook Receiver** (`POST /api/webhooks/gmail-reply`)
- Google Cloud Pub/Sub notifies when user replies
- Parser extracts command (`/done`, `/comment: text`)
- Validates user permissions → updates task via updateTask() → emits task_updated event

---

## 2. Event Types (8 total)

| Event | Trigger | Default Email | Default In-App |
|---|---|---|---|
| **task_assigned** | Task assigned to user | ✅ ON | ✅ ON |
| **task_mentioned** | @mentioned in comment | ✅ ON | ✅ ON |
| **status_changed** | State changed | ✅ ON | ✅ ON |
| **due_soon** | 24h/1h before due | ✅ ON | ✅ ON |
| **comment_added** | New comment | ✅ ON | ✅ ON |
| **project_created** | Project created | ❌ OFF | ✅ ON |
| **member_invited** | Invited to workspace | ✅ ON | ✅ ON |
| **task_completed** | Task marked done | ❌ OFF | ❌ OFF |

---

## 3. Database Schema (4 new tables)

> **Reality check (2026-09-09):** the four tables exist
> (`notification_preferences`, `notifications`, `email_threads`,
> `failed_jobs`), but the shipped columns differ from the sketch below — most
> importantly `notifications` uses a **`read_at` timestamp**, not a `read`
> boolean. Code that wrote to a `read` column silently failed in production
> until it was fixed. The authoritative shape is the migrations
> (`20260828190000_notification_system_schema_reconciliation.sql`) and
> `src/lib/supabase/database.types.ts`.

```sql
-- notification_preferences: user controls which events/channels they receive
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  event_type TEXT NOT NULL, -- task_assigned, mentioned, status_changed, etc.
  channel TEXT NOT NULL, -- email, in_app
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, organization_id, event_type, channel)
);

-- notifications: in-app notification log
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  event_type TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id),
  actor_id UUID REFERENCES auth.users(id), -- who triggered
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX(user_id, read, created_at DESC)
);

-- email_threads: track Gmail message IDs for reply parsing
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  message_id TEXT UNIQUE NOT NULL,
  gmail_thread_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX(message_id)
);

-- failed_jobs: audit trail of job failures
CREATE TABLE failed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT,
  user_id UUID,
  error_message TEXT,
  retry_count INT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX(created_at DESC)
);
```

---

## 4. API Endpoints (5 new)

> **Reality check (2026-09-09):** of the endpoints below, only
> `GET`/`PATCH /api/admin/notification-preferences` and
> `POST /api/webhooks/gmail-reply` (returning `501`) exist.
> `POST /api/admin/notifications/test`, `GET /api/admin/notifications` and
> `PATCH /api/admin/notifications/{id}` were never built — in-app
> notifications are read and marked read client-side through
> `src/lib/supabase/notifications-repo.ts` under RLS, not through an API
> route. The real, complete route list is
> [`API_ENDPOINTS.md`](./API_ENDPOINTS.md).

**`GET /api/admin/notification-preferences`**
- Returns user's preferences for all 8 events × 2 channels

**`PATCH /api/admin/notification-preferences`**
- Body: `{ eventType, channel, enabled }`
- Updates single preference

**`POST /api/admin/notifications/test`**
- Body: `{ eventType: 'task_assigned' }`
- Sends test email/notification to user

**`GET /api/admin/notifications`**
- Query: `?limit=20&offset=0`
- Returns notifications from notifications table

**`PATCH /api/admin/notifications/{id}`**
- Body: `{ read: true }`
- Marks notification as read

**`POST /api/webhooks/gmail-reply`** (Internal)
- Receives Google Cloud Pub/Sub webhook
- Parses `/done`, `/comment: text`, `/status: X` commands
- Updates task, creates comment, emits event
- Validates: user exists, has access, task exists

---

## 5. Gmail Integration

### Email Headers (for tracking)
```
Message-ID: <task-{taskId}-{ts}@taskflow.local>
X-TaskFlow-Ref: task_{taskId}_{jwt_signature}
Reply-To: tasks+{threadId}@taskflow.local
```

### Command Parser
```
"/done" → mark task completed
"/comment: hello" → add comment
"/status: In Progress" → change state
"<any text>" → entire body = comment
```

### Retry Logic
- BullMQ retries: 3x with backoff (30s, 5m, 30m)
- Failed jobs logged to failed_jobs table
- Cron job alerts on failures

---

## 6. React Email Templates (8 files)

- **TaskAssignedEmail.tsx** - "Se te asignó X"
- **TaskMentionedEmail.tsx** - "@mentioned in Y"
- **StatusChangedEmail.tsx** - "Estado cambió a Z"
- **DueSoonEmail.tsx** - "Vence en 24h/1h"
- **CommentAddedEmail.tsx** - "Nuevo comentario"
- **ProjectCreatedEmail.tsx** - "Proyecto creado"
- **MemberInvitedEmail.tsx** - "Invitado a X"
- **TaskCompletedEmail.tsx** - "Tarea completada"

All use BaseLayout with logo + footer + unsubscribe link.

---

## 7. UI Components (3 new)

> **Reality check (2026-09-09):** only `NotificationBell.tsx` exists (in the
> topbar, fed by `BoardContext`). There is **no** `/admin/notificaciones`
> page and no `NotificationCenter.tsx`; preferences are stored in
> `notification_preferences` and reachable only through the
> `/api/admin/notification-preferences` route, with no UI on top of it yet.

**`/admin/notificaciones` Page**
- Table: 8 events × 2 channels
- Toggles to enable/disable each combination
- Test button: sends sample email
- Real-time save via PATCH

**NotificationBell.tsx** (in topbar)
- Bell icon with unread count
- Dropdown: latest 10 notifications
- Link to full Notification Center

**NotificationCenter.tsx** (full page)
- Table: Date | Event | From | Action | Mark Read
- Pagination, filters, mark all as read

---

## 8. Testing (45 tests)

**Unit (25 tests):**
- Parser: `/done`, `/comment`, `/status`, edge cases
- Email renderers: null dates, missing data
- Validators: permissions, user exists
- Preferences: defaults, overrides

**Integration (15 tests):**
- Event → job → email → thread created
- Reply received → task updated → event emitted
- Failed job → retry → succeeds
- User preferences respected

**E2E (5 tests):**
- Assign task → email + in-app received
- Reply email with `/done` → state updates
- Toggle preferences → persist
- Mark notification read → unread count updates

**Coverage:** 75%+ critical paths

---

## 9. Dependencies

Originally planned:

```json
{
  "bullmq": "^3.x",
  "@vercel/kv": "^0.2.x",
  "react-email": "^0.0.x",
  "@react-email/components": "^0.0.x",
  "googleapis": "^118.x",
  "html-to-text": "^9.x"
}
```

> **Reality check (2026-09-09):** none of `bullmq`, `@vercel/kv`,
> `@react-email/components`, `googleapis` or `html-to-text` is in
> `package.json`. What is actually installed for this feature is
> `resend ^4.0.1` and `react-email ^6.9.2`. Rate limiting uses
> `@upstash/redis` / `@upstash/ratelimit`, not `@vercel/kv` (though
> `src/lib/rate-limit.ts` still accepts the `KV_REST_API_*` variable names the
> Vercel Marketplace Upstash integration provisions).

---

## 10. Deployment Requirements

What the **outbound** path actually needs today:

- `RESEND_API_KEY` + a domain verified in Resend
- `NOTIFICATION_FROM_EMAIL` on that verified domain
- `NEXT_PUBLIC_APP_URL` (absolute links in emails; must be the real public
  URL, `https://task.conto.ec` in production)
- `INTERNAL_NOTIFY_SECRET`, shared between Vercel and the Postgres triggers
  that call `/api/internal/notify-event`
- `SUPABASE_SERVICE_ROLE_KEY` — `notify.ts` runs server-side with it
- Migrations applied (tables **and** the notification triggers)
- Sentry project (optional)

Only needed for the still-unbuilt inbound path: Gmail API credentials with
Domain-Wide Delegation and a Google Cloud Pub/Sub topic + subscription.
`JWT_SECRET` is **not** used for email header signing — in this codebase it
signs the Google OAuth `state` parameter. Vercel KV is not required.

---

## Success Criteria (original targets — see actual status below each)

- 8 event types → email + in-app notifications
  — ✅ 8/8 wired via Postgres triggers as of
  `20260829010000_wire_remaining_notification_events.sql`
  (`task_assigned`, `comment_added`, `task_completed` on their own tables;
  `member_invited` on `organization_members`; `project_created` on `boards`,
  scoped to org owners/admins; `due_soon` inside the existing hourly cron
  function; `task_mentioned` and `status_changed` from the earlier pass).
- Gmail replies parsed (`/done`, `/comment`)
  — ❌ blocked; no Google Workspace account exists to send/receive via.
  `/api/webhooks/gmail-reply` returns `501`.
- User preferences per event × channel
  — ✅ `notification_preferences` table + `/api/admin/notification-preferences`
  route, both live.
- 45 tests passing
  — the notification-specific suite was rewritten around the actual
  (synchronous, non-BullMQ) implementation; see `notify.test.ts` and the
  overall count in `OBSERVABILITY.md`.
- <100ms UI notification creation / 99.9% email delivery SLA
  — not measured; no traffic at production scale yet (see main README).

---

**Status:** Partially implemented — see the status note at the top of this file.
