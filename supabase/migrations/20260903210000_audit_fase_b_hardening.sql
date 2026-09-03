-- Auditoría 2026-09-03, Fase B: endurecimiento. Ver AUDITORIA_2026-09-03.md,
-- hallazgos 4 (parcial — el `order by` de los cursores ya se agregó en la
-- Fase A), 5 y 7. El hallazgo 8 (day_of_week/day_of_month) se investigó y
-- resultó no ser un bug activo: RecurringTasksPanel.tsx nunca envía esos
-- campos, así que hoy siempre son null para toda plantilla creada desde la
-- UI — no hay una promesa incumplida visible para el usuario. Se deja
-- documentado en el código para cuando la UI los exponga de verdad.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Escalonar los 4 crons horarios — antes todos disparaban en el mismo
--    minuto (0 * * * *), con riesgo de que dos jobs toquen la misma fila de
--    `tasks` a la vez sin orden de lock consistente entre ellos.
--    taskflow_check_due_soon_tasks se deja en :00 (solo lee/notifica, no
--    escribe tasks).
-- ─────────────────────────────────────────────────────────────────────────

select cron.alter_job(
  (select jobid from cron.job where jobname = 'taskflow_execute_due_date_automations'),
  schedule => '5 * * * *'
);
select cron.alter_job(
  (select jobid from cron.job where jobname = 'taskflow_execute_sla_automations'),
  schedule => '15 * * * *'
);
select cron.alter_job(
  (select jobid from cron.job where jobname = 'taskflow_execute_recurring_tasks'),
  schedule => '25 * * * *'
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Límite de longitud en título/comentario. Confirmado antes de aplicar
--    (max actual: título 36 chars, comentario 35 chars) que ningún dato
--    existente viola estos límites.
-- ─────────────────────────────────────────────────────────────────────────

alter table tasks add constraint tasks_title_length check (length(title) <= 300);

create or replace function public.mcp_create_task(
  p_token text,
  p_title text,
  p_priority text default 'medium',
  p_due_date date default null,
  p_board_name text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sess record;
  v_board record;
  v_column record;
  v_next_position numeric;
  v_task_id uuid;
begin
  select * into sess from mcp_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if sess.id is null then
    raise exception 'token inválido, revocado o expirado';
  end if;
  if not ('tasks:write' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:write';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title es requerido';
  end if;
  if length(p_title) > 300 then
    raise exception 'title no puede superar 300 caracteres';
  end if;
  if p_priority not in ('high', 'medium', 'low') then
    p_priority := 'medium';
  end if;

  if p_board_name is not null then
    select * into v_board from boards where tenant_id = sess.tenant_id and name = p_board_name limit 1;
  end if;
  if v_board.id is null then
    select * into v_board from boards where tenant_id = sess.tenant_id order by created_at asc limit 1;
  end if;
  if v_board.id is null then
    raise exception 'no se encontró un board para esta organización';
  end if;

  if not public.has_permission_as(v_board.id, 'task.create', sess.user_id) then
    raise exception 'el usuario del token no tiene permiso task.create en este board';
  end if;

  select * into v_column from board_columns where board_id = v_board.id order by order_index asc limit 1;
  if v_column.id is null then
    raise exception 'el board no tiene columnas';
  end if;

  select coalesce(max(position), 0) + 1 into v_next_position from tasks where column_id = v_column.id;

  insert into tasks (tenant_id, board_id, column_id, title, priority, due_date, position)
  values (sess.tenant_id, v_board.id, v_column.id, trim(p_title), p_priority, p_due_date, v_next_position)
  returning id into v_task_id;

  update mcp_sessions set last_used_at = now() where id = sess.id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (sess.tenant_id, sess.user_id, 'mcp_agent', 'task_created_from_mcp', 'task', v_task_id,
          jsonb_build_object('session_id', sess.id, 'client', sess.client));

  return v_task_id;
end;
$function$;

create or replace function public.mcp_add_comment(
  p_token text,
  p_task_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sess record;
  v_task record;
  v_comment_id uuid;
begin
  select * into sess from mcp_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if sess.id is null then
    raise exception 'token inválido, revocado o expirado';
  end if;
  if not ('tasks:write' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:write';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'body es requerido';
  end if;
  if length(p_body) > 4000 then
    raise exception 'body no puede superar 4000 caracteres';
  end if;

  select * into v_task from tasks where id = p_task_id and tenant_id = sess.tenant_id;
  if v_task.id is null then
    raise exception 'tarea no encontrada';
  end if;

  if not public.has_permission_as(v_task.board_id, 'task.update', sess.user_id) then
    raise exception 'el usuario del token no tiene permiso task.update en este board';
  end if;

  insert into comments (task_id, author_id, body, source)
  values (p_task_id, sess.user_id, trim(p_body), 'mcp_agent')
  returning id into v_comment_id;

  update mcp_sessions set last_used_at = now() where id = sess.id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (sess.tenant_id, sess.user_id, 'mcp_agent', 'comment_added_from_mcp', 'task', p_task_id,
          jsonb_build_object('session_id', sess.id));

  return v_comment_id;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) resolve_share_link ya no expone el hilo interno del equipo — un link
--    público (incluso con permission='view') solo debe mostrar comentarios
--    de otros invitados, nunca la discusión interna del equipo en `source
--    in ('web','email','mcp_agent','automation')`.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.resolve_share_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_link public_share_links%rowtype;
  v_result jsonb;
begin
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into v_link from public_share_links
  where token_hash = v_hash and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_link.id is null then
    raise exception 'link inválido o expirado';
  end if;

  update public_share_links set last_accessed_at = now() where id = v_link.id;

  if v_link.scope = 'task' then
    select jsonb_build_object(
      'scope', 'task',
      'permission', v_link.permission,
      'boardName', b.name,
      'task', jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'priority', t.priority,
        'dueDate', t.due_date,
        'columnLabel', bc.label,
        'createdAt', t.created_at
      ),
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'body', c.body, 'source', c.source,
          'guestName', c.guest_name, 'createdAt', c.created_at
        ) order by c.created_at asc)
        from comments c where c.task_id = t.id and c.source = 'guest'
      ), '[]'::jsonb)
    ) into v_result
    from tasks t
    join boards b on b.id = t.board_id
    join board_columns bc on bc.id = t.column_id
    where t.id = v_link.task_id;
  else
    select jsonb_build_object(
      'scope', 'board',
      'permission', v_link.permission,
      'boardName', b.name,
      'columns', coalesce((
        select jsonb_agg(jsonb_build_object('id', bc.id, 'label', bc.label, 'orderIndex', bc.order_index) order by bc.order_index)
        from board_columns bc where bc.board_id = b.id
      ), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'priority', t.priority,
          'dueDate', t.due_date, 'columnId', t.column_id
        ))
        from tasks t where t.board_id = b.id and t.parent_task_id is null
      ), '[]'::jsonb)
    ) into v_result
    from boards b
    where b.id = v_link.board_id;
  end if;

  return v_result;
end;
$function$;
