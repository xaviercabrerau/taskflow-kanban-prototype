create or replace function public.mcp_list_tasks(p_token text)
returns table(
  id uuid, title text, priority text, board_name text, column_label text,
  due_date date, assignee_name text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sess record;
begin
  select * into sess from mcp_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if sess.id is null then
    raise exception 'token inválido o revocado';
  end if;
  if not ('tasks:read' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:read';
  end if;

  update mcp_sessions set last_used_at = now() where id = sess.id;

  return query
    select t.id, t.title, t.priority, b.name, c.label, t.due_date::date, t.assignee_name
    from tasks t
    join boards b on b.id = t.board_id
    join board_columns c on c.id = t.column_id
    where t.tenant_id = sess.tenant_id
    order by t.created_at desc
    limit 200;
end;
$function$;

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
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if sess.id is null then
    raise exception 'token inválido o revocado';
  end if;
  if not ('tasks:write' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:write';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title es requerido';
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

create or replace function public.mcp_move_task(
  p_token text,
  p_task_id uuid,
  p_column_label text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sess record;
  v_task record;
  v_column record;
  v_next_position numeric;
begin
  select * into sess from mcp_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if sess.id is null then
    raise exception 'token inválido o revocado';
  end if;
  if not ('tasks:write' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:write';
  end if;

  select * into v_task from tasks where id = p_task_id and tenant_id = sess.tenant_id;
  if v_task.id is null then
    raise exception 'tarea no encontrada';
  end if;

  select * into v_column from board_columns
  where board_id = v_task.board_id and lower(label) = lower(p_column_label)
  limit 1;
  if v_column.id is null then
    raise exception 'columna "%" no existe en ese board', p_column_label;
  end if;

  select coalesce(max(position), 0) + 1 into v_next_position from tasks where column_id = v_column.id;

  update tasks set column_id = v_column.id, position = v_next_position where id = p_task_id;

  update mcp_sessions set last_used_at = now() where id = sess.id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (sess.tenant_id, sess.user_id, 'mcp_agent', 'task_moved_from_mcp', 'task', p_task_id,
          jsonb_build_object('session_id', sess.id, 'to_column', v_column.label));
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
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if sess.id is null then
    raise exception 'token inválido o revocado';
  end if;
  if not ('tasks:write' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:write';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'body es requerido';
  end if;

  select * into v_task from tasks where id = p_task_id and tenant_id = sess.tenant_id;
  if v_task.id is null then
    raise exception 'tarea no encontrada';
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

revoke all on function public.mcp_list_tasks(text) from public;
revoke all on function public.mcp_create_task(text, text, text, date, text) from public;
revoke all on function public.mcp_move_task(text, uuid, text) from public;
revoke all on function public.mcp_add_comment(text, uuid, text) from public;
grant execute on function public.mcp_list_tasks(text) to anon, authenticated;
grant execute on function public.mcp_create_task(text, text, text, date, text) to anon, authenticated;
grant execute on function public.mcp_move_task(text, uuid, text) to anon, authenticated;
grant execute on function public.mcp_add_comment(text, uuid, text) to anon, authenticated;
