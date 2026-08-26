-- Automation engine: execute automation rules on task insert/update events
create or replace function public.execute_automation_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  event_type text;
  r record;
  action jsonb;
begin
  if coalesce(current_setting('automation.running', true), 'false') = 'true' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    event_type := 'task_created';
  elsif TG_OP = 'UPDATE' and NEW.column_id is distinct from OLD.column_id then
    event_type := 'status_changed';
  else
    return new;
  end if;

  perform set_config('automation.running', 'true', true);

  for r in
    select r.*
    from automation_rules r
    join boards b on b.workspace_id = r.workspace_id
    where b.id = NEW.board_id
      and r.tenant_id = NEW.tenant_id
      and r.is_active
      and r.trigger->>'type' = event_type
      and (
        event_type <> 'status_changed'
        or r.trigger->>'to_column_id' is null
        or (r.trigger->>'to_column_id')::uuid = NEW.column_id
      )
  loop
    if exists (select 1 from automation_executions ae where ae.rule_id = r.id and ae.task_id = NEW.id) then
      continue;
    end if;

    begin
      for action in select jsonb_array_elements(coalesce(r.actions, '[]'::jsonb))
      loop
        if action->>'type' = 'move_to_column' then
          update tasks set column_id = (action->>'column_id')::uuid where id = NEW.id;
        elsif action->>'type' = 'set_field' then
          if action->>'field' not in ('priority', 'tag', 'assignee_name') then
            raise exception 'campo no permitido: %', action->>'field';
          end if;
          execute format('update tasks set %I = $1 where id = $2', action->>'field')
            using (action->>'value'), NEW.id;
        elsif action->>'type' = 'add_comment' then
          insert into comments(task_id, author_id, body, source)
            values (NEW.id, null, action->>'body', 'automation');
        end if;
      end loop;

      insert into automation_executions(rule_id, task_id, status) values (r.id, NEW.id, 'success');
    exception when others then
      insert into automation_executions(rule_id, task_id, status, error_message)
        values (r.id, NEW.id, 'error', SQLERRM);
    end;
  end loop;

  return new;
end;
$function$;

revoke execute on function public.execute_automation_rules() from anon, authenticated, public;

drop trigger if exists execute_automation_rules_trigger on public.tasks;
create trigger execute_automation_rules_trigger
  after insert or update on public.tasks
  for each row
  execute function public.execute_automation_rules();

-- allow automation-driven column moves to bypass RBAC on the originating user
create or replace function public.check_task_move_permission()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or coalesce(current_setting('automation.running', true), 'false') = 'true' then
    return new;
  end if;

  if new.column_id is distinct from old.column_id then
    if not (public.has_permission(new.board_id, 'task.move') or public.has_permission(new.board_id, 'task.update')) then
      raise exception 'permission denied: se requiere el permiso task.move para cambiar de columna';
    end if;
  end if;
  if (new.title, new.description, new.priority, new.assignee_name, new.tag, new.due_date, new.start_date)
     is distinct from (old.title, old.description, old.priority, old.assignee_name, old.tag, old.due_date, old.start_date)
  then
    if not public.has_permission(new.board_id, 'task.update') then
      raise exception 'permission denied: se requiere el permiso task.update para editar estos campos';
    end if;
  end if;
  return new;
end;
$function$;
