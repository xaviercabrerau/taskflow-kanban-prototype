
-- public.log_task_activity(): populates activity_log with a per-field
-- history of what changed on a task and when. This is an independent
-- AFTER INSERT/UPDATE trigger on public.tasks; it does not touch
-- notifications (notify_task_status_changed) or automations
-- (execute_automation_rules) — those keep their own separate triggers,
-- Postgres runs all AFTER triggers for the same event in trigger-name
-- alphabetical order, so no coordination is needed between them.

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log(task_id, actor_id, action, metadata)
    values (NEW.id, actor, 'created', jsonb_build_object('title', NEW.title));
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.column_id is distinct from OLD.column_id then
      insert into public.activity_log(task_id, actor_id, action, metadata)
      values (NEW.id, actor, 'status_changed',
        jsonb_build_object('from', OLD.column_id, 'to', NEW.column_id));
    end if;

    if NEW.assignee_name is distinct from OLD.assignee_name then
      insert into public.activity_log(task_id, actor_id, action, metadata)
      values (NEW.id, actor, 'assigned',
        jsonb_build_object('from', OLD.assignee_name, 'to', NEW.assignee_name));
    end if;

    if NEW.priority is distinct from OLD.priority then
      insert into public.activity_log(task_id, actor_id, action, metadata)
      values (NEW.id, actor, 'field_updated',
        jsonb_build_object('field', 'priority', 'from', OLD.priority, 'to', NEW.priority));
    end if;

    if NEW.due_date is distinct from OLD.due_date then
      insert into public.activity_log(task_id, actor_id, action, metadata)
      values (NEW.id, actor, 'field_updated',
        jsonb_build_object('field', 'due_date', 'from', OLD.due_date, 'to', NEW.due_date));
    end if;

    if NEW.title is distinct from OLD.title then
      insert into public.activity_log(task_id, actor_id, action, metadata)
      values (NEW.id, actor, 'field_updated',
        jsonb_build_object('field', 'title', 'from', OLD.title, 'to', NEW.title));
    end if;

    return NEW;
  end if;

  return NEW;
end;
$function$;

create trigger trg_log_task_activity_insert
  after insert on public.tasks
  for each row execute function public.log_task_activity();

create trigger trg_log_task_activity_update
  after update on public.tasks
  for each row execute function public.log_task_activity();
