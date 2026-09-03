-- Deuda técnica documentada en AUDITORIA_2026-09-03.md, hallazgo 8:
-- recurring_task_templates.day_of_week/day_of_month existían en el esquema
-- y se validaban, pero execute_recurring_tasks() nunca los leía al avanzar
-- next_run_at — solo sumaba N semanas/meses desde el valor anterior, sin
-- anclarse al día elegido. Ahora, tras cada avance:
--   - weekly: si day_of_week está seteado, corrige hacia adelante (0-6 días)
--     hasta caer en ese día de la semana.
--   - monthly: si day_of_month está seteado, fuerza el día dentro del mes
--     ya avanzado (siempre válido: la tabla limita day_of_month a 1-28).
-- Ambas correcciones son idempotentes (si ya está alineado, el ajuste es 0)
-- y siempre avanzan el reloj (nunca retroceden más allá del propio avance
-- de N semanas/meses), así que no cambian las garantías de terminación del
-- loop ni el lock de solapamiento agregado en la Fase A.
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
  if not pg_try_advisory_xact_lock(hashtext('execute_recurring_tasks')) then
    return;
  end if;

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

    v_next := tpl.next_run_at;
    loop
      v_next := case tpl.frequency
        when 'daily' then v_next + (tpl.interval_count || ' days')::interval
        when 'weekly' then v_next + (tpl.interval_count || ' weeks')::interval
        else v_next + (tpl.interval_count || ' months')::interval
      end;

      if tpl.frequency = 'weekly' and tpl.day_of_week is not null then
        v_next := v_next + (((tpl.day_of_week - extract(dow from v_next)::int) + 7) % 7) * interval '1 day';
      elsif tpl.frequency = 'monthly' and tpl.day_of_month is not null then
        v_next := date_trunc('month', v_next) + (tpl.day_of_month - 1) * interval '1 day'
          + (v_next - date_trunc('day', v_next));
      end if;

      exit when v_next > now();
    end loop;

    update recurring_task_templates
      set last_run_at = now(), next_run_at = v_next
      where id = tpl.id;
  end loop;
end;
$function$;
