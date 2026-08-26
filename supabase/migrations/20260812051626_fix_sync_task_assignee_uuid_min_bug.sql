-- Bug fix: min(uuid) is not a valid aggregate in Postgres (no default
-- min/max operator class for uuid), so the free-text auto-link branch of
-- sync_task_assignee() crashed with "function min(uuid) does not exist" on
-- ANY insert/update that sets assignee_name without assignee_user_id —
-- i.e. automations, webhooks, MCP tools, and demo/seed data. Never hit in
-- production yet because the one write that already ran (the backfill in
-- add_task_assignee_user_id_with_sync) only exercised the other branch
-- (assignee_user_id already set). Fixed by running two plain queries
-- (count, then a separate lookup) instead of aggregating a uuid column.
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
    select count(*)
      into v_match_count
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = NEW.tenant_id
      and lower(coalesce(p.full_name, p.email)) = lower(NEW.assignee_name);

    if v_match_count = 1 then
      select m.user_id
        into v_match_user_id
      from public.organization_members m
      join public.profiles p on p.id = m.user_id
      where m.organization_id = NEW.tenant_id
        and lower(coalesce(p.full_name, p.email)) = lower(NEW.assignee_name)
      limit 1;

      NEW.assignee_user_id := v_match_user_id;
    end if;
  end if;

  return NEW;
end;
$function$;
