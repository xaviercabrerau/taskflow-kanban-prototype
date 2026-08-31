-- Fixes a real production bug found while live-testing the MCP feature:
-- mcp_list_tasks declares `RETURNS TABLE(id uuid, ...)`, which implicitly
-- creates a PL/pgSQL variable named `id` in scope for the whole function
-- body. Both `where id = sess.tenant_id` (organizations lookup) and
-- `update mcp_sessions set last_used_at = now() where id = sess.id` then
-- have an ambiguous `id` — Postgres raised "42702 column reference \"id\"
-- is ambiguous" on every real call, making list_tasks completely unusable
-- via any MCP token (confirmed live: the tool always failed with a generic
-- client-facing error, the real cause only visible in server logs).
create or replace function public.mcp_list_tasks(p_token text)
 returns table(id uuid, title text, priority text, board_name text, column_label text, due_date date, assignee_name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  sess record;
begin
  select * into sess from mcp_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if sess.id is null then
    raise exception 'token inválido, revocado o expirado';
  end if;
  if not ('tasks:read' = any(sess.token_scopes)) then
    raise exception 'el token no tiene el scope tasks:read';
  end if;
  if not coalesce((select mcp_tokens_enabled from organizations where organizations.id = sess.tenant_id), true) then
    raise exception 'la organización deshabilitó el acceso MCP';
  end if;

  update mcp_sessions set last_used_at = now() where mcp_sessions.id = sess.id;

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
