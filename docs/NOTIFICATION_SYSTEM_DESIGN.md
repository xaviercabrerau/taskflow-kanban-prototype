# TaskFlow Notification System + Gmail Integration
## Design Specification

**Version:** 1.0  
**Date:** 2026-08-16  
**Phase:** Semana 3 Punto 6  
**Status:** Design Approved, Ready for Implementation

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

---

## 10. Deployment Requirements

- Gmail API credentials (Google Cloud Console)
- Google Cloud Pub/Sub topic + webhook registered
- Vercel KV linked in environment
- `NOTIFICATION_FROM_EMAIL` env variable
- `JWT_SECRET` for email header signing
- Supabase migrations applied (4 tables)
- Sentry project for error tracking

---

## Success Criteria

✅ 8 event types → email + in-app notifications  
✅ Gmail replies parsed (`/done`, `/comment`)  
✅ User preferences per event × channel  
✅ 45 tests passing  
✅ <100ms UI notification creation  
✅ 99.9% email delivery SLA  

---

**Status:** ✅ Ready for Implementation Plan
