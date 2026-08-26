-- webhooks_inbound.token and webhooks_outbound.secret were plaintext text
-- columns, inconsistent with the hash-only pattern already established by
-- mcp_sessions.token_hash. webhooks_outbound is defined but has no delivery
-- mechanism wired to it anywhere in the app (dead table) — hashed for
-- consistency regardless. webhooks_inbound IS live: ingest_webhook_task()
-- validates against it, and the UI lets an owner re-view/copy the token
-- indefinitely. Move to hash storage + a create-time RPC that returns the
-- plaintext token exactly once, matching create_mcp_session's pattern.

alter table webhooks_inbound add column token_hash text;
update webhooks_inbound set token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
alter table webhooks_inbound alter column token_hash set not null;
alter table webhooks_inbound add constraint webhooks_inbound_token_hash_key unique (token_hash);
alter table webhooks_inbound drop column token;

alter table webhooks_outbound add column secret_hash text;
update webhooks_outbound set secret_hash = encode(extensions.digest(secret, 'sha256'), 'hex');
alter table webhooks_outbound alter column secret_hash set not null;
alter table webhooks_outbound drop column secret;

create or replace function public.create_inbound_webhook(
  p_tenant_id uuid,
  p_board_id uuid,
  p_column_id uuid
)
returns table (id uuid, token text, board_id uuid, column_id uuid, is_active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_row record;
begin
  if not is_org_owner(p_tenant_id) then
    raise exception 'Solo el owner de la organización puede crear webhooks entrantes';
  end if;

  insert into webhooks_inbound (tenant_id, board_id, column_id, token_hash)
  values (p_tenant_id, p_board_id, p_column_id, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning webhooks_inbound.id, webhooks_inbound.board_id, webhooks_inbound.column_id,
            webhooks_inbound.is_active, webhooks_inbound.created_at
  into v_row;

  return query select v_row.id, v_token, v_row.board_id, v_row.column_id, v_row.is_active, v_row.created_at;
end;
$$;
revoke all on function public.create_inbound_webhook(uuid, uuid, uuid) from public;
grant execute on function public.create_inbound_webhook(uuid, uuid, uuid) to authenticated;

create or replace function public.ingest_webhook_task(
  p_token text,
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
  p_due_date timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hook record;
  new_task_id uuid;
  next_position numeric;
begin
  select * into hook from webhooks_inbound
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active
  limit 1;
  if hook.id is null then
    raise exception 'webhook inválido o inactivo';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title es requerido';
  end if;

  if p_priority not in ('high', 'medium', 'low') then
    p_priority := 'medium';
  end if;

  select coalesce(max(position), 0) + 1 into next_position
  from tasks where column_id = hook.column_id;

  insert into tasks (tenant_id, board_id, column_id, title, description, priority, due_date, position)
  values (hook.tenant_id, hook.board_id, hook.column_id, p_title, p_description, p_priority, p_due_date, next_position)
  returning id into new_task_id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (hook.tenant_id, null, 'webhook_inbound', 'task_created_from_webhook', 'task', new_task_id,
          jsonb_build_object('webhook_id', hook.id));

  return new_task_id;
end;
$function$;

revoke all on function public.ingest_webhook_task(text, text, text, text, timestamptz) from public;
grant execute on function public.ingest_webhook_task(text, text, text, text, timestamptz) to anon, authenticated;
