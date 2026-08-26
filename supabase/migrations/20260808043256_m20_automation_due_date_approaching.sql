create or replace function public.execute_due_date_automations()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  t record;
  action jsonb;
begin
  perform set_config('automation.running', 'true', true);

  for r in
    select r.*
    from automation_rules r
    where r.is_active
      and r.trigger->>'type' = 'due_date_approaching'
  loop
    for t in
      select tasks.*
      from tasks
      join boards on boards.id = tasks.board_id
      where boards.workspace_id = r.workspace_id
        and tasks.due_date is not null
        and tasks.due_date <= now() + ((r.trigger->>'days_before')::int || ' days')::interval
        and tasks.due_date > now()
        and not exists (
          select 1 from automation_executions ae where ae.rule_id = r.id and ae.task_id = tasks.id
        )
    loop
      begin
        for action in select jsonb_array_elements(coalesce(r.actions, '[]'::jsonb))
        loop
          if action->>'type' = 'move_to_column' then
            update tasks set column_id = (action->>'column_id')::uuid where id = t.id;
          elsif action->>'type' = 'set_field' then
            if action->>'field' not in ('priority', 'tag', 'assignee_name') then
              raise exception 'campo no permitido: %', action->>'field';
            end if;
            execute format('update tasks set %I = $1 where id = $2', action->>'field')
              using (action->>'value'), t.id;
          elsif action->>'type' = 'add_comment' then
            insert into comments(task_id, author_id, body, source)
              values (t.id, null, action->>'body', 'automation');
          end if;
        end loop;

        insert into automation_executions(rule_id, task_id, status) values (r.id, t.id, 'success');
      exception when others then
        insert into automation_executions(rule_id, task_id, status, error_message)
          values (r.id, t.id, 'error', SQLERRM);
      end;
    end loop;
  end loop;
end;
$function$;

revoke execute on function public.execute_due_date_automations() from anon, authenticated, public;

select cron.schedule(
  'taskflow_execute_due_date_automations',
  '0 * * * *',
  $$select public.execute_due_date_automations();$$
)
where not exists (select 1 from cron.job where jobname = 'taskflow_execute_due_date_automations');
