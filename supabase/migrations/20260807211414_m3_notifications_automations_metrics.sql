-- 7.6 Notificaciones
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null check (type in ('assigned','mentioned','due_soon','status_changed')),
  title           text not null,
  body            text,
  related_task_id uuid references tasks(id) on delete set null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table notification_preferences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  workspace_id      uuid references workspaces(id) on delete cascade, -- null = default global
  channel           text not null default 'both' check (channel in ('email','in_app','both','none')),
  digest_frequency  text not null default 'realtime' check (digest_frequency in ('realtime','daily','weekly'))
);
-- null-safe: permite un solo registro por (user_id, workspace_id) incluyendo el caso "global" (workspace_id null)
create unique index uq_notification_prefs on notification_preferences(user_id, (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000')));

create table email_threads (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references tasks(id) on delete cascade,
  gmail_thread_id  text,
  gmail_message_id text,
  thread_token     text not null unique,
  direction        text not null check (direction in ('outbound','inbound')),
  created_at       timestamptz not null default now()
);

-- 7.7 Automatizaciones e integraciones
create table automation_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references organizations(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  is_active    boolean not null default true,
  trigger      jsonb not null,
  conditions   jsonb not null default '[]',
  actions      jsonb not null default '[]',
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table automation_executions (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid not null references automation_rules(id) on delete cascade,
  task_id       uuid references tasks(id) on delete set null,
  status        text not null check (status in ('success','failed','skipped')),
  error_message text,
  executed_at   timestamptz not null default now()
);

create table integrations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references organizations(id) on delete cascade,
  provider       text not null check (provider in ('slack','teams','zoom','n8n','openai','anthropic','github')),
  config         jsonb not null default '{}',
  credentials_enc text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table webhooks_outbound (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references organizations(id) on delete cascade,
  event_type  text not null,
  target_url  text not null,
  secret      text not null,
  is_active   boolean not null default true
);

create table mcp_sessions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_scopes text[] not null default array[]::text[],
  client       text not null check (client in ('claude_chat','claude_cowork')),
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- 7.8 Métricas / BI
create table metrics_snapshots (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references boards(id) on delete cascade,
  sprint_id     uuid references sprints(id) on delete cascade,
  metric_type   text not null check (metric_type in ('velocity','burndown','cycle_time','throughput')),
  snapshot_date date not null,
  value         jsonb not null default '{}'
);
create unique index uq_metrics_snapshot on metrics_snapshots(board_id, (coalesce(sprint_id, '00000000-0000-0000-0000-000000000000')), metric_type, snapshot_date);

create index idx_notifications_user_read on notifications(user_id, read_at);
