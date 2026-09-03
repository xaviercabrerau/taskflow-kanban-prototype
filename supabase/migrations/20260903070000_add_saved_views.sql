-- Roadmap Fase 2, item 2: vistas guardadas / filtros personalizados.
-- Personal (per-user) saved combinations of board filters (search text,
-- assignee, priority, tag) — e.g. "Mis tareas urgentes sin asignar".
-- Not shared across the team in v1 (YAGNI — a shared/team-view concept
-- would need its own permission model; this is scoped to what the roadmap
-- item asked for).
create table saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_saved_views_user_board on saved_views(user_id, board_id);

alter table saved_views enable row level security;

-- Strictly personal: a user only ever sees/manages their own saved views,
-- regardless of org role — same boundary pattern as any other per-user
-- preference table in this schema (e.g. notification_preferences).
create policy saved_views_own on saved_views
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
