create or replace function public.execute_automation_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  event_type text;
  rule_rec record;
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

  for rule_rec in
    select ar.*
    from automation_rules ar
    join boards b on b.workspace_id = ar.workspace_id
    where b.id = NEW.board_id
      and ar.tenant_id = NEW.tenant_id
      and ar.is_active
      and ar.trigger->>'type' = event_type
      and (
        event_type <> 'status_changed'
        or ar.trigger->>'to_column_id' is null
        or (ar.trigger->>'to_column_id')::uuid = NEW.column_id
      )
  loop
    if exists (select 1 from automation_executions ae where ae.rule_id = rule_rec.id and ae.task_id = NEW.id) then
      continue;
    end if;

    begin
      for action in select jsonb_array_elements(coalesce(rule_rec.actions, '[]'::jsonb))
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

      insert into automation_executions(rule_id, task_id, status) values (rule_rec.id, NEW.id, 'success');
    exception when others then
      insert into automation_executions(rule_id, task_id, status, error_message)
        values (rule_rec.id, NEW.id, 'error', SQLERRM);
    end;
  end loop;

  return new;
end;
$function$;

revoke execute on function public.execute_automation_rules() from anon, authenticated, public;

create or replace function public.execute_due_date_automations()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rule_rec record;
  task_rec record;
  action jsonb;
begin
  perform set_config('automation.running', 'true', true);

  for rule_rec in
    select ar.*
    from automation_rules ar
    where ar.is_active
      and ar.trigger->>'type' = 'due_date_approaching'
  loop
    for task_rec in
      select tk.*
      from tasks tk
      join boards bd on bd.id = tk.board_id
      where bd.workspace_id = rule_rec.workspace_id
        and tk.due_date is not null
        and tk.due_date <= now() + ((rule_rec.trigger->>'days_before')::int || ' days')::interval
        and tk.due_date > now()
        and not exists (
          select 1 from automation_executions ae where ae.rule_id = rule_rec.id and ae.task_id = tk.id
        )
    loop
      begin
        for action in select jsonb_array_elements(coalesce(rule_rec.actions, '[]'::jsonb))
        loop
          if action->>'type' = 'move_to_column' then
            update tasks set column_id = (action->>'column_id')::uuid where id = task_rec.id;
          elsif action->>'type' = 'set_field' then
            if action->>'field' not in ('priority', 'tag', 'assignee_name') then
              raise exception 'campo no permitido: %', action->>'field';
            end if;
            execute format('update tasks set %I = $1 where id = $2', action->>'field')
              using (action->>'value'), task_rec.id;
          elsif action->>'type' = 'add_comment' then
            insert into comments(task_id, author_id, body, source)
              values (task_rec.id, null, action->>'body', 'automation');
          end if;
        end loop;

        insert into automation_executions(rule_id, task_id, status) values (rule_rec.id, task_rec.id, 'success');
      exception when others then
        insert into automation_executions(rule_id, task_id, status, error_message)
          values (rule_rec.id, task_rec.id, 'error', SQLERRM);
      end;
    end loop;
  end loop;
end;
$function$;

revoke execute on function public.execute_due_date_automations() from anon, authenticated, public;
