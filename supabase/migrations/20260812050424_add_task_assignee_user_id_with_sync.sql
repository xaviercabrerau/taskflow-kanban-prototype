-- Adds a real FK column for task assignee, alongside the existing free-text
-- assignee_name (kept as-is for automations/webhooks/MCP flows that only
-- know names, and for legacy demo data with no matching real member).
alter table public.tasks
  add column assignee_user_id uuid references auth.users(id) on delete set null;

create index idx_tasks_assignee_user_id on public.tasks(assignee_user_id);

-- Trigger keeps assignee_user_id and assignee_name in sync regardless of
-- which write path touches the row (frontend UI, automation set_field
-- actions, MCP tools, webhook ingest) — none of those call sites need to
-- change:
--   - If assignee_user_id is set: assignee_name is overwritten from the
--     member's CURRENT profile (handles renames automatically).
--   - If only assignee_name (free text) is set: best-effort auto-link to a
--     real org member when there's exactly one unambiguous match in this
--     tenant; otherwise left unlinked (still just free text, same as
--     before this migration).
create or replace function public.sync_task_assignee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_label text;
  v_match_count int;
  v_match_user_id uuid;
begin
  if NEW.assignee_user_id is not null then
    select coalesce(p.full_name, p.email, NEW.assignee_user_id::text)
      into v_label
    from public.profiles p
    where p.id = NEW.assignee_user_id;

    if v_label is not null then
      NEW.assignee_name := v_label;
    end if;
  elsif NEW.assignee_name is not null and length(trim(NEW.assignee_name)) > 0 then
    select count(*), min(m.user_id)
      into v_match_count, v_match_user_id
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = NEW.tenant_id
      and lower(coalesce(p.full_name, p.email)) = lower(NEW.assignee_name);

    if v_match_count = 1 then
      NEW.assignee_user_id := v_match_user_id;
    end if;
  end if;

  return NEW;
end;
$function$;

revoke execute on function public.sync_task_assignee() from public, anon, authenticated;

create trigger trg_sync_task_assignee
before insert or update of assignee_user_id, assignee_name on public.tasks
for each row
execute function public.sync_task_assignee();

-- Backfill existing rows: link any task whose free-text assignee_name
-- matches exactly one current org member (skip ambiguous matches).
update public.tasks t
set assignee_user_id = p.id
from public.organization_members m
join public.profiles p on p.id = m.user_id
where m.organization_id = t.tenant_id
  and t.assignee_user_id is null
  and t.assignee_name is not null
  and lower(coalesce(p.full_name, p.email)) = lower(t.assignee_name)
  and not exists (
    select 1
    from public.organization_members m2
    join public.profiles p2 on p2.id = m2.user_id
    where m2.organization_id = t.tenant_id
      and p2.id <> p.id
      and lower(coalesce(p2.full_name, p2.email)) = lower(t.assignee_name)
  );
