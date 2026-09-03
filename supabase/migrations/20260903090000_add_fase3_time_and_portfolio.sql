-- Roadmap Fase 3: time tracking (item 8), workload view (item 9, built on
-- top of time_entries), and cross-board portfolio dashboard (item 10).

-- 1. Time tracking: a task can have a running timer (ended_at is null) or
-- completed/manual entries (ended_at set, minutes computed on stop or
-- entered directly for a manual log). One user can have at most one
-- running entry per task, enforced by a partial unique index rather than
-- application logic alone.
create table time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes integer,
  note text,
  created_at timestamptz not null default now()
);

create unique index idx_time_entries_one_running_per_user_task
  on time_entries(task_id, user_id)
  where ended_at is null;

create index idx_time_entries_task on time_entries(task_id);
create index idx_time_entries_user on time_entries(user_id);

alter table time_entries enable row level security;

-- Same tenant-membership boundary as comments/attachments/task_links:
-- any org member of the task's tenant can read/write time entries on it
-- (not scoped to "only your own entries" — teammates seeing each other's
-- logged time is the point of a workload/hours report).
create policy time_entries_all on time_entries
  for all
  using (
    exists (
      select 1 from tasks t
      where t.id = time_entries.task_id
        and is_org_member(t.tenant_id)
        and session_meets_mfa(t.tenant_id)
    )
  );

-- 2. Cross-board portfolio summary — one row per board the caller can see
-- (RLS on boards/tasks/board_columns applies normally, SECURITY INVOKER).
create or replace function public.portfolio_summary()
returns table (
  board_id uuid,
  board_name text,
  total_tasks bigint,
  done_tasks bigint,
  overdue_tasks bigint
)
language sql
stable
set search_path = public
as $$
  select
    b.id,
    b.name,
    count(t.id),
    count(t.id) filter (where coalesce(bc.is_done_state, false)),
    count(t.id) filter (where not coalesce(bc.is_done_state, false) and t.due_date is not null and t.due_date < now())
  from boards b
  left join tasks t on t.board_id = b.id
  left join board_columns bc on bc.id = t.column_id
  where not coalesce(b.archived, false)
  group by b.id, b.name
  order by b.name;
$$;

revoke execute on function public.portfolio_summary() from public;
grant execute on function public.portfolio_summary() to authenticated;
