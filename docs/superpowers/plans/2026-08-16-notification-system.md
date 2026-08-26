# TaskFlow Notification System + Gmail Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement fully functional notification system: 8 event types, 2 channels (Email + In-App), Gmail bidirectional replies, user preference control, 45 tests.

**Architecture:** Event-driven (BullMQ + Vercel KV). Routes emit events → processor sends email (Gmail API) + creates in-app notification. Google Cloud Pub/Sub webhook receives Gmail replies → parser extracts `/done`/`/comment`/`/status` commands → updates tasks.

**Tech Stack:** Next.js 16, TypeScript, Supabase (RLS), BullMQ, Vercel KV, Gmail API, React Email, Google Cloud Pub/Sub

## Global Constraints

- TypeScript strict mode — no implicit any
- API responses: camelCase; database: snake_case
- Error responses: `{ error: "msg" }` with HTTP status (400/401/403/500)
- All admin routes require JWT auth; Gmail webhook uses JWT signature verification
- Rate limit: 100 emails/min per user (BullMQ backpressure)
- Email templates must support plaintext fallback (html-to-text)
- All tests mock external APIs (no Gmail/Supabase calls in tests)
- Migrations: `<timestamp>_<name>.sql` in `supabase/migrations/`
- Atomic commits per task: `feat:/fix:/test:/docs:` prefix

---

## Architecture & Files

**Database (4 migrations):**
- notification_preferences: user event×channel preferences
- notifications: in-app notification log
- email_threads: Gmail message ID tracking for reply parsing
- failed_jobs: audit trail of job failures

**Job Processor:**
- types.ts: Event, Job, Notification types
- emitter.ts: enqueueNotificationJob(), validateEvent()
- processor.ts: BullMQ worker handler
- gmail.ts: Gmail API client, command parser

**Email (8 templates + layouts):**
- TaskAssigned, TaskMentioned, StatusChanged, DueSoon, CommentAdded, ProjectCreated, MemberInvited, TaskCompleted
- Layouts: BaseLayout, TaskNotificationLayout
- Helpers: formatDate(), taskUrl(), renderEmail()

**API Endpoints (5 routes):**
- GET/PATCH /api/admin/notification-preferences
- GET/PATCH /api/admin/notifications
- POST /api/admin/notifications/test
- POST /api/webhooks/gmail-reply

**UI (3 components):**
- /admin/notificaciones page (preferences table)
- NotificationBell.tsx (topbar)
- NotificationCenter (full page view)

**Tests (45 total):**
- Unit (25): emitter, processor, gmail parser, renderers, validators
- Integration (15): event→job→email flow, reply→update, retries, preferences
- E2E (5): full user scenarios

---

## Summary

**Total Tasks:** 15  
**Complexity:** High (async queues, Gmail API, webhooks, multipart MIME)  
**Duration Estimate:** 4-6 weeks  
**Execution:** Subagent-Driven (1 fresh implementer per task, review gates)  

---

**Status:** ✅ Design Complete, Ready for Implementation