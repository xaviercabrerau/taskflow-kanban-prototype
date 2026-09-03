-- Fase 5: tareas recurrentes. Una plantilla en recurring_task_templates
-- describe una tarea a recrear periódicamente (diaria/semanal/mensual);
-- execute_recurring_tasks() (pg_cron, cada hora) crea la tarea real en
-- `tasks` cuando next_run_at llega, y avanza next_run_at hasta que quede en
-- el futuro — mismo patrón que execute_sla_automations() en
-- 20260903060000_add_sla_stale_automation.sql.

create table recurring_task_templates (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references organizations(id) on delete cascade,
  board_id         uuid not null references boards(id) on delete cascade,
  column_id        uuid not null references board_columns(id),
  title            text not null,
  description      text,
  priority         text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_user_id uuid references auth.users(id),
  frequency        text not null check (frequency in ('daily','weekly','monthly')),
  interval_count   int not null default 1 check (interval_count > 0),
  day_of_week      int check (day_of_week between 0 and 6),   -- solo frequency='weekly' (0=domingo)
  day_of_month     int check (day_of_month between 1 and 28), -- solo frequency='monthly' (cap en 28 para evitar meses cortos)
  next_run_at      timestamptz not null,
  last_run_at      timestamptz,
  active           boolean not null default true,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

create index recurring_task_templates_tenant_idx on recurring_task_templates(tenant_id);
create index recurring_task_templates_due_idx on recurring_task_templates(next_run_at) where active;

alter table recurring_task_templates enable row level security;
create policy recurring_task_templates_all on recurring_task_templates for all using (public.is_org_member(tenant_id));

create or replace function public.execute_recurring_tasks()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  tpl record;
  v_new_task_id uuid;
  v_position float;
  v_next timestamptz;
begin
  for tpl in
    select * from recurring_task_templates where active and next_run_at <= now()
  loop
    select coalesce(min(position), 0) - 1 into v_position from tasks where column_id = tpl.column_id;

    insert into tasks (tenant_id, board_id, column_id, title, description, priority, position, created_by)
    values (tpl.tenant_id, tpl.board_id, tpl.column_id, tpl.title, tpl.description, tpl.priority, v_position, tpl.created_by)
    returning id into v_new_task_id;

    if tpl.assignee_user_id is not null then
      insert into task_assignees (task_id, user_id) values (v_new_task_id, tpl.assignee_user_id);
    end if;

    -- Avanza next_run_at desde su propio valor (no desde now()) para no
    -- acumular drift, pero repite el avance si el template estuvo inactivo
    -- o el cron no corrió por un tiempo, hasta dejarlo en el futuro.
    v_next := tpl.next_run_at;
    loop
      v_next := case tpl.frequency
        when 'daily' then v_next + (tpl.interval_count || ' days')::interval
        when 'weekly' then v_next + (tpl.interval_count || ' weeks')::interval
        else v_next + (tpl.interval_count || ' months')::interval
      end;
      exit when v_next > now();
    end loop;

    update recurring_task_templates
      set last_run_at = now(), next_run_at = v_next
      where id = tpl.id;
  end loop;
end;
$function$;

revoke execute on function public.execute_recurring_tasks() from anon, authenticated, public;

select cron.schedule(
  'taskflow_execute_recurring_tasks',
  '0 * * * *',
  $$select public.execute_recurring_tasks();$$
)
where not exists (select 1 from cron.job where jobname = 'taskflow_execute_recurring_tasks');
