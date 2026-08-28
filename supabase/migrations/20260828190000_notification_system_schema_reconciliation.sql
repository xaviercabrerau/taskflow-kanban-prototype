-- Reconciles the never-wired BullMQ/Gmail notification system's schema with
-- the notifications table that ALREADY has live triggers writing to it
-- (notify_comment_mentions, notify_task_status_changed use tenant_id/type/
-- title/body/related_task_id). Rather than replace that schema (which would
-- break those triggers), we add one column and adapt the processor code to
-- the existing shape.

-- Additive, safe: existing triggers simply won't set this, defaulting to null.
alter table public.notifications
  add column if not exists actor_id uuid references auth.users(id) on delete set null;

-- notification_preferences is empty and has no live triggers/readers — safe
-- to replace with the schema the (already-written, already-tested) admin
-- route and processor expect: per-event-type, per-channel toggles.
drop table if exists public.notification_preferences;
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in (
    'task_assigned', 'task_mentioned', 'status_changed', 'due_soon',
    'comment_added', 'project_created', 'member_invited', 'task_completed'
  )),
  channel text not null check (channel in ('email', 'in_app')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id, event_type, channel)
);

create index notification_preferences_user_org_idx
  on public.notification_preferences (user_id, organization_id);

alter table public.notification_preferences enable row level security;
create policy notification_prefs_all on public.notification_preferences
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- email_threads: tracks Gmail Message-IDs for reply threading. New table,
-- no collision (the prior colliding migration for this name was deleted).
create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null unique,
  gmail_thread_id text,
  created_at timestamptz not null default now()
);

create index email_threads_message_id_idx on public.email_threads (message_id);
create index email_threads_task_id_idx on public.email_threads (task_id);

alter table public.email_threads enable row level security;
create policy email_threads_own on public.email_threads
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- failed_jobs: internal ops/audit trail for the notification worker, never
-- queried by end users — only the service-role client (processor.ts) reads
-- or writes it. RLS enabled with no policies deliberately locks it to
-- service-role only.
create table public.failed_jobs (
  id uuid primary key default gen_random_uuid(),
  event_type text,
  user_id uuid,
  error_message text not null,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

create index failed_jobs_created_at_idx on public.failed_jobs (created_at desc);

alter table public.failed_jobs enable row level security;
