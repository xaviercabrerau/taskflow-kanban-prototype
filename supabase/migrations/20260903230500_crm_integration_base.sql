-- Base común para integración bidireccional con CRM (Tarea <-> Ticket/Caso),
-- compartida por las opciones evaluadas (n8n / adaptador propio) en
-- docs/plans/2026-09-03-crm-integration-design.md.

-- Vínculo tarea <-> ticket del CRM. Único por tenant (dos tenants distintos
-- pueden tener tickets con el mismo id en sus respectivos CRMs).
alter table public.tasks
  add column external_ticket_id text,
  add column synced_from_crm_at timestamptz;

create unique index tasks_external_ticket_id_per_tenant
  on public.tasks (tenant_id, external_ticket_id)
  where external_ticket_id is not null;

-- Extiende ingest_webhook_task (ya usado por el webhook entrante genérico,
-- llamado directamente vía PostgREST por quien tenga el token) para que,
-- si el payload trae p_external_ticket_id y ya existe una tarea con ese id
-- en el tenant del webhook, actualice esa tarea en vez de crear una nueva.
-- synced_from_crm_at se setea en ambos casos (creación y actualización) —
-- es el marcador que la lógica de automatizaciones saliente (crm_sync /
-- webhook) usa para no reenviar el eco de vuelta al CRM.
--
-- Se agrega un parámetro nuevo (p_external_ticket_id), lo que cambia la
-- firma de la función — `create or replace` NO reemplaza una función con
-- distinta firma, crearía un overload ambiguo para PostgREST. Se elimina
-- explícitamente la firma anterior de 5 parámetros antes de crear la nueva.
drop function if exists public.ingest_webhook_task(text, text, text, text, timestamptz);

create function public.ingest_webhook_task(
  p_token text,
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
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
  select * into hook from webhooks_inbound where token = p_token and is_active limit 1;
  if hook.id is null then
    raise exception 'webhook inválido o inactivo';
  end if;

  if p_priority not in ('high', 'medium', 'low') then
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
        priority = p_priority,
        due_date = p_due_date,
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
    hook.tenant_id, hook.board_id, hook.column_id, p_title, p_description, p_priority, p_due_date, next_position,
    p_external_ticket_id, case when p_external_ticket_id is not null then now() else null end
  )
  returning id into new_task_id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (hook.tenant_id, null, 'webhook_inbound', 'task_created_from_webhook', 'task', new_task_id,
          jsonb_build_object('webhook_id', hook.id, 'external_ticket_id', p_external_ticket_id));

  return new_task_id;
end;
$function$;

revoke all on function public.ingest_webhook_task(text, text, text, text, timestamptz, text) from public;
grant execute on function public.ingest_webhook_task(text, text, text, text, timestamptz, text) to anon, authenticated;
