-- Roadmap Fase 1, item 3: SLA / escalamiento automático.
--
-- Adds a new automation trigger type ("sla_stale") that fires when a task
-- has sat in a non-done column for more than N hours without moving —
-- distinct from the existing "due_date_approaching" trigger, which only
-- reacts to a due_date field and says nothing about how long a task has
-- been stuck. Reuses the existing action-execution machinery (move,
-- set_field, add_comment, webhook) unchanged.

-- 1. Track when a task last entered its current column.
alter table tasks
  add column column_entered_at timestamptz not null default now();

update tasks set column_entered_at = created_at where column_entered_at is null;

create or replace function public.set_column_entered_at()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if NEW.column_id is distinct from OLD.column_id then
    NEW.column_entered_at := now();
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_set_column_entered_at on tasks;
create trigger trg_set_column_entered_at
  before update on tasks
  for each row execute function set_column_entered_at();

-- 2. Periodic check (same shape as execute_due_date_automations): find
-- active "sla_stale" rules, find tasks that have been in a non-done column
-- longer than the configured threshold, skip tasks this rule already ran
-- on, apply matching conditions, then run the rule's actions.
create or replace function public.execute_sla_automations()
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
      and ar.trigger->>'type' = 'sla_stale'
  loop
    for task_rec in
      select tk.*
      from tasks tk
      join boards bd on bd.id = tk.board_id
      join board_columns bc on bc.id = tk.column_id
      where bd.workspace_id = rule_rec.workspace_id
        and not coalesce(bc.is_done_state, false)
        and now() - tk.column_entered_at >= ((rule_rec.trigger->>'hours')::numeric || ' hours')::interval
        and not exists (
          select 1 from automation_executions ae where ae.rule_id = rule_rec.id and ae.task_id = tk.id
        )
        and automation_conditions_match(rule_rec.conditions, tk.priority, tk.tag, tk.assignee_name, tk.title)
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
          elsif action->>'type' = 'webhook' then
            if not is_safe_webhook_url(action->>'url') then
              raise exception 'la url del webhook no es válida (debe ser https y no apuntar a una red privada)';
            end if;
            perform net.http_post(
              url := action->>'url',
              body := jsonb_build_object(
                'event', 'sla_stale',
                'rule_id', rule_rec.id,
                'rule_name', rule_rec.name,
                'task_id', task_rec.id,
                'task_title', task_rec.title,
                'occurred_at', now()
              ),
              headers := jsonb_build_object('Content-Type', 'application/json')
            );
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

revoke execute on function public.execute_sla_automations() from anon, authenticated, public;

select cron.schedule(
  'taskflow_execute_sla_automations',
  '0 * * * *',
  $$select public.execute_sla_automations();$$
)
where not exists (select 1 from cron.job where jobname = 'taskflow_execute_sla_automations');
