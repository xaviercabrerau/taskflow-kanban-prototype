alter table public.mcp_sessions
  add column token_hash text,
  add column name text not null default 'MCP token';

alter table public.mcp_sessions add constraint mcp_sessions_token_hash_key unique (token_hash);

alter table public.mcp_sessions enable row level security;

create policy mcp_sessions_select on public.mcp_sessions
  for select using (user_id = auth.uid());

-- Sin políticas de insert/update/delete: toda escritura pasa por las
-- funciones SECURITY DEFINER de abajo (create_mcp_session /
-- revoke_mcp_session), que validan auth.uid() internamente.

create or replace function public.create_mcp_session(
  p_client text,
  p_name text,
  p_scopes text[]
)
returns table(session_id uuid, token text)
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

  select organization_id into v_tenant_id
  from organization_members where user_id = auth.uid() limit 1;
  if v_tenant_id is null then
    raise exception 'usuario sin organización';
  end if;

  v_token := 'tfmcp_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into mcp_sessions (tenant_id, user_id, client, name, token_scopes, token_hash)
  values (v_tenant_id, auth.uid(), p_client, p_name, p_scopes, v_hash)
  returning id into v_id;

  return query select v_id, v_token;
end;
$function$;

revoke all on function public.create_mcp_session(text, text, text[]) from public;
grant execute on function public.create_mcp_session(text, text, text[]) to authenticated;

create or replace function public.revoke_mcp_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update mcp_sessions set revoked_at = now()
  where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'sesión no encontrada';
  end if;
end;
$function$;

revoke all on function public.revoke_mcp_session(uuid) from public;
grant execute on function public.revoke_mcp_session(uuid) to authenticated;
