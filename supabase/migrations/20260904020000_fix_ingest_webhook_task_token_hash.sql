-- Corrige una regresión real introducida en 20260903230500_crm_integration_base.sql:
-- esa migración reescribió ingest_webhook_task() copiando el cuerpo de la
-- migración ORIGINAL (m38_inbound_webhooks.sql, `where token = p_token`),
-- sin ver que 20260816042000_hash_webhook_secrets.sql ya había migrado la
-- tabla a token_hash (hash sha256) y actualizado la función para comparar
-- `token_hash = encode(digest(p_token, 'sha256'), 'hex')`. El resultado: la
-- función quedó referenciando una columna `token` que no existe —
-- rompiéndola por completo (cualquier llamada fallaría con "column token
-- does not exist"), no solo un problema semántico. Detectado en esta misma
-- sesión al verificar el esquema real de webhooks_inbound antes de dar por
-- buena la corrección de la revisión de código anterior.

create or replace function public.ingest_webhook_task(
  p_token text,
  p_title text,
  p_description text default null,
  p_priority text default null,
  p_due_date timestamptz default null,
  p_external_ticket_id text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hook record;
  existing_task_id uuid;
  new_task_id uuid;
  next_position numeric;
begin
  select * into hook from webhooks_inbound
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active
    limit 1;
  if hook.id is null then
    raise exception 'webhook inválido o inactivo';
  end if;

  if p_priority is not null and p_priority not in ('high', 'medium', 'low') then
    p_priority := 'medium';
  end if;

  if p_external_ticket_id is not null then
    select id into existing_task_id
    from tasks
    where tenant_id = hook.tenant_id and external_ticket_id = p_external_ticket_id
    limit 1;
  end if;

  if existing_task_id is not null then
    update tasks
    set title = coalesce(p_title, title),
        description = coalesce(p_description, description),
        priority = coalesce(p_priority, priority),
        due_date = coalesce(p_due_date, due_date),
        synced_from_crm_at = now()
    where id = existing_task_id;

    insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
    values (hook.tenant_id, null, 'webhook_inbound', 'task_updated_from_webhook', 'task', existing_task_id,
            jsonb_build_object('webhook_id', hook.id, 'external_ticket_id', p_external_ticket_id));

    return existing_task_id;
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title es requerido';
  end if;

  select coalesce(max(position), 0) + 1 into next_position
  from tasks where column_id = hook.column_id;

  insert into tasks (
    tenant_id, board_id, column_id, title, description, priority, due_date, position,
    external_ticket_id, synced_from_crm_at
  )
  values (
    hook.tenant_id, hook.board_id, hook.column_id, p_title, p_description, coalesce(p_priority, 'medium'), p_due_date, next_position,
    p_external_ticket_id, case when p_external_ticket_id is not null then now() else null end
  )
  on conflict (tenant_id, external_ticket_id) where external_ticket_id is not null
  do update set
    title = coalesce(excluded.title, tasks.title),
    description = coalesce(excluded.description, tasks.description),
    priority = coalesce(excluded.priority, tasks.priority),
    due_date = coalesce(excluded.due_date, tasks.due_date),
    synced_from_crm_at = now()
  returning id into new_task_id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (hook.tenant_id, null, 'webhook_inbound', 'task_created_from_webhook', 'task', new_task_id,
          jsonb_build_object('webhook_id', hook.id, 'external_ticket_id', p_external_ticket_id));

  return new_task_id;
end;
$function$;
