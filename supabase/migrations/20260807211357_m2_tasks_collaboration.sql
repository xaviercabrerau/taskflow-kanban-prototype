-- 7.4 Tareas
create table epics (
  id      uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  name    text not null,
  color   text,
  status  text
);

create table sprints (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references boards(id) on delete cascade,
  name       text not null,
  start_date date,
  end_date   date,
  status     text not null default 'planned' check (status in ('planned','active','closed'))
);

create table tasks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references organizations(id) on delete cascade,
  board_id        uuid not null references boards(id) on delete cascade,
  column_id       uuid not null references board_columns(id),
  parent_task_id  uuid references tasks(id) on delete set null,
  epic_id         uuid references epics(id) on delete set null,
  sprint_id       uuid references sprints(id) on delete set null,
  title           text not null,
  description     text,
  priority        text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date        timestamptz,
  start_date      timestamptz,
  story_points    int,
  custom_fields   jsonb not null default '{}',
  position        float not null default 0,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create table tags (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references organizations(id) on delete cascade,
  name      text not null,
  color     text
);

create table task_tags (
  task_id uuid not null references tasks(id) on delete cascade,
  tag_id  uuid not null references tags(id) on delete cascade,
  primary key (task_id, tag_id)
);

create table task_links (
  id              uuid primary key default gen_random_uuid(),
  source_task_id  uuid not null references tasks(id) on delete cascade,
  target_task_id  uuid not null references tasks(id) on delete cascade,
  link_type       text not null check (link_type in ('blocks','related_to','duplicates'))
);

-- 7.5 Colaboración
create table comments (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references tasks(id) on delete cascade,
  author_id           uuid references auth.users(id),
  body                text not null,
  mentioned_user_ids  uuid[] not null default array[]::uuid[],
  source              text not null default 'web' check (source in ('web','email','mcp_agent')),
  created_at          timestamptz not null default now(),
  edited_at           timestamptz
);

create table attachments (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references tasks(id) on delete cascade,
  file_name        text not null,
  file_url         text not null,
  file_size_bytes  bigint,
  mime_type        text,
  uploaded_by      uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

create table activity_log (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  actor_id   uuid references auth.users(id),
  action     text not null,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- audit_log es append-only: sin políticas UPDATE/DELETE para roles de aplicación (ver migración RLS).
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references organizations(id) on delete cascade,
  actor_id       uuid references auth.users(id),
  source         text not null check (source in ('web','api','mcp_agent','automation')),
  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  ip_address     inet,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index idx_tasks_tenant_due on tasks(tenant_id, due_date);
create index idx_tasks_board_column_position on tasks(board_id, column_id, position);
create index idx_comments_task on comments(task_id);
create index idx_activity_log_task on activity_log(task_id);
create index idx_audit_log_tenant on audit_log(tenant_id, created_at desc);
