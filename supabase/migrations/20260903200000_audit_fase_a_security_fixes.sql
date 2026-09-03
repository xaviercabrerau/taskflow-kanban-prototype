-- Auditoría 2026-09-03, Fase A: correcciones de seguridad críticas/altas.
-- Ver AUDITORIA_2026-09-03.md, hallazgos 1, 2, 3, 9 (+ un bug real
-- descubierto al implementar el hallazgo 9: la migración de hoy que agregó
-- source='guest' a comments_source_check reemplazó el constraint completo
-- y sin querer eliminó 'automation' — usado por execute_sla_automations /
-- execute_due_date_automations en su acción add_comment. Se corrige aquí.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) session_meets_mfa(tenant_id) en las 3 tablas nuevas de hoy que se
--    saltaron el patrón ya establecido en el resto del esquema (ver
--    20260811002544_mfa_aal2_rls_defense_in_depth.sql).
-- ─────────────────────────────────────────────────────────────────────────

alter policy public_share_links_all on public.public_share_links
  using (public.is_org_member(tenant_id) and public.session_meets_mfa(tenant_id));

alter policy recurring_task_templates_all on public.recurring_task_templates
  using (public.is_org_member(tenant_id) and public.session_meets_mfa(tenant_id));

alter policy task_github_links_all on public.task_github_links
  using (public.is_org_member(tenant_id) and public.session_meets_mfa(tenant_id));

-- create_share_link es SECURITY DEFINER: la policy de arriba no la cubre,
-- necesita su propio chequeo explícito.
create or replace function public.create_share_link(
  p_board_id uuid,
  p_task_id uuid,
  p_scope text,
  p_permission text,
  p_expires_at timestamptz,
  p_label text
)
returns table(link_id uuid, token text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_token text;
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;
  if p_scope not in ('board','task') then
    raise exception 'scope inválido';
  end if;
  if p_permission not in ('view','comment') then
    raise exception 'permission inválido';
  end if;
  if p_scope = 'task' and p_task_id is null then
    raise exception 'task_id requerido para scope=task';
  end if;

  select b.tenant_id into v_tenant_id
  from boards b
  where b.id = p_board_id and public.is_org_member(b.tenant_id);
  if v_tenant_id is null then
    raise exception 'tablero no encontrado o sin permiso';
  end if;

  if not public.session_meets_mfa(v_tenant_id) then
    raise exception 'Se requiere verificación en dos pasos para crear links compartibles.';
  end if;

  if p_task_id is not null then
    if not exists (select 1 from tasks t where t.id = p_task_id and t.board_id = p_board_id) then
      raise exception 'tarea no encontrada en este tablero';
    end if;
  end if;

  v_token := 'tfshare_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public_share_links (tenant_id, board_id, task_id, scope, permission, token_hash, label, created_by, expires_at)
  values (v_tenant_id, p_board_id, p_task_id, p_scope, p_permission, v_hash, nullif(trim(p_label), ''), auth.uid(), p_expires_at)
  returning id into v_id;

  return query select v_id, v_token;
end;
$function$;

revoke all on function public.create_share_link(uuid, uuid, text, text, timestamptz, text) from public;
grant execute on function public.create_share_link(uuid, uuid, text, text, timestamptz, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Advisory lock contra solapamiento del propio cron job en las 3
--    funciones que insertan filas desde SQL sin protección de concurrencia.
--    pg_try_advisory_xact_lock se libera solo al final de la transacción
--    (el statement completo que dispara pg_cron), así que una segunda
--    ejecución que arranque mientras la primera sigue corriendo simplemente
--    no hace nada en vez de reprocesar las mismas filas.
-- ─────────────────────────────────────────────────────────────────────────

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
      exit when v_next > now();
    end loop;

    update recurring_task_templates
      set last_run_at = now(), next_run_at = v_next
      where id = tpl.id;
  end loop;
end;
$function$;

revoke execute on function public.execute_recurring_tasks() from anon, authenticated, public;

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
  if not pg_try_advisory_xact_lock(hashtext('execute_sla_automations')) then
    return;
  end if;

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
      order by tk.id
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
  if not pg_try_advisory_xact_lock(hashtext('execute_due_date_automations')) then
    return;
  end if;

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
        and automation_conditions_match(rule_rec.conditions, tk.priority, tk.tag, tk.assignee_name, tk.title)
      order by tk.id
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
                'event', 'due_date_approaching',
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

revoke execute on function public.execute_due_date_automations() from anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Registrar taskflow_execute_recurring_tasks en get_cron_health() —
--    quedó fuera cuando se creó el job 50 minutos después de esta función
--    en la misma sesión. El lado TypeScript (MONITORED_JOBS, extraído a
--    src/lib/cron-jobs.ts) se corrige en el mismo commit de esta migración.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.get_cron_health()
returns table (
  job_name text,
  expected_interval text,
  last_run_at timestamptz,
  last_status text,
  is_stale boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with monitored_jobs (job_name, expected_interval, max_age) as (
    values
      ('taskflow_check_due_soon_tasks', 'hourly', interval '2 hours'),
      ('taskflow_execute_due_date_automations', 'hourly', interval '2 hours'),
      ('taskflow_execute_sla_automations', 'hourly', interval '2 hours'),
      ('taskflow_execute_recurring_tasks', 'hourly', interval '2 hours'),
      ('purge-expired-audit-logs', 'daily', interval '26 hours'),
      ('record-daily-metrics-snapshots', 'daily', interval '26 hours')
  ),
  last_runs as (
    select
      j.jobname,
      max(d.end_time) as last_end_time,
      (array_agg(d.status order by d.end_time desc))[1] as last_status
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname in (select mj.job_name from monitored_jobs mj)
    group by j.jobname
  )
  select
    mj.job_name,
    mj.expected_interval,
    lr.last_end_time,
    lr.last_status,
    (lr.last_end_time is null or lr.last_end_time < v_now - mj.max_age) as is_stale
  from monitored_jobs mj
  left join last_runs lr on lr.jobname = mj.job_name;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) comments_all: WITH CHECK explícito. Sin esto, cualquier miembro
--    autenticado del tenant puede insertar directamente un comentario con
--    source='guest' y guest_name arbitrario, falsificando que vino de un
--    visitante externo del link público. El WITH CHECK debe repetir la
--    condición de membresía/MFA del USING (si no, Postgres usaría USING
--    también como check por defecto, y al fijar WITH CHECK explícito eso
--    se pierde) — ver ALTER POLICY en la doc de Postgres. No afecta a
--    execute_sla_automations/add_share_link_comment: corren SECURITY
--    DEFINER como dueño de la función, que ya bypasea RLS.
--
--    De paso corrige un bug real introducido en la migración de hoy que
--    agregó 'guest' a comments_source_check: reemplazó el constraint
--    completo y sin querer eliminó 'automation' (agregado en
--    20260808043431_m22_allow_automation_comment_source.sql), rompiendo la
--    acción add_comment de execute_sla_automations/execute_due_date_automations.
-- ─────────────────────────────────────────────────────────────────────────

alter table comments drop constraint comments_source_check;
alter table comments add constraint comments_source_check
  check (source in ('web', 'email', 'mcp_agent', 'automation', 'guest'));

alter policy comments_all on public.comments
  with check (
    exists (
      select 1 from tasks t
      where t.id = comments.task_id
        and is_org_member(t.tenant_id)
        and session_meets_mfa(t.tenant_id)
    )
    and source <> 'guest'
  );
