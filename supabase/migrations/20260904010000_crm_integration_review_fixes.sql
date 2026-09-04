-- Correcciones de la revisión de código/seguridad de la integración CRM
-- (docs/plans/2026-09-03-crm-integration-design.md), 2026-09-04:
--
-- 1. ingest_webhook_task: una actualización parcial (ej. solo título) desde
--    el CRM reseteaba priority a 'medium' y borraba due_date de la tarea
--    existente, porque esos dos campos se asignaban directo desde el
--    parámetro en vez de con coalesce como title/description. Se cambia el
--    default de p_priority a null (antes 'medium') para poder distinguir
--    "no vino en el payload" de "vino explícitamente" y aplicar coalesce
--    también en el camino de actualización; el default 'medium' se sigue
--    aplicando solo al crear una tarea nueva.
-- 2. Condición de carrera: dos webhooks concurrentes con el mismo
--    external_ticket_id podían ambos fallar el "select" de existencia y
--    ambos intentar insert — el índice único evitaba el dato duplicado pero
--    el segundo caía en una excepción no manejada. Se agrega
--    `on conflict ... do update` sobre el mismo índice parcial.
-- 3. Faltaban índices en crm_sync_requests(tenant_id)/(task_id).
-- 4. Una clave de field_mapping no reconocida se enviaba como `null` al CRM
--    en vez de omitirse — podía borrar un campo válido del lado del CRM.
-- 5. Si la integración no tenía secreto configurado, la llamada salía sin
--    autenticación en silencio en vez de fallar — ahora es un error
--    explícito (no se envía el payload de la tarea sin auth por accidente).

create index if not exists crm_sync_requests_tenant_idx on crm_sync_requests(tenant_id);
create index if not exists crm_sync_requests_task_idx on crm_sync_requests(task_id);

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
  select * into hook from webhooks_inbound where token = p_token and is_active limit 1;
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

  -- on conflict cubre la carrera entre dos webhooks concurrentes con el
  -- mismo external_ticket_id que ambos llegaron aquí porque el select de
  -- arriba no encontró la fila todavía (aún no comprometida) — el índice
  -- parcial tasks_external_ticket_id_per_tenant es el target del conflicto,
  -- por lo que la cláusula where debe repetir su misma condición.
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

-- crm_sync: field_mapping ahora omite claves no reconocidas en vez de
-- enviarlas como null, y falla explícitamente si la integración no tiene
-- secreto configurado (en vez de mandar el payload sin autenticación).
create or replace function public.execute_automation_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  event_type text;
  rule_rec record;
  action jsonb;
  v_integration record;
  v_secret text;
  v_url text;
  v_body jsonb;
  v_mapping jsonb;
  v_key text;
  v_field text;
  v_mapped_value jsonb;
  v_request_id bigint;
  v_headers jsonb;
  v_is_create boolean;
begin
  if coalesce(current_setting('automation.running', true), 'false') = 'true' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    event_type := 'task_created';
  elsif TG_OP = 'UPDATE' and NEW.column_id is distinct from OLD.column_id then
    event_type := 'status_changed';
  else
    return new;
  end if;

  if NEW.synced_from_crm_at is not null and NEW.synced_from_crm_at > now() - interval '5 seconds' then
    return new;
  end if;

  perform set_config('automation.running', 'true', true);

  for rule_rec in
    select ar.*
    from automation_rules ar
    join boards b on b.workspace_id = ar.workspace_id
    where b.id = NEW.board_id
      and ar.tenant_id = NEW.tenant_id
      and ar.is_active
      and ar.trigger->>'type' = event_type
      and (
        event_type <> 'status_changed'
        or ar.trigger->>'to_column_id' is null
        or (ar.trigger->>'to_column_id')::uuid = NEW.column_id
      )
  loop
    if exists (select 1 from automation_executions ae where ae.rule_id = rule_rec.id and ae.task_id = NEW.id) then
      continue;
    end if;

    if not automation_conditions_match(rule_rec.conditions, NEW.priority, NEW.tag, NEW.assignee_name, NEW.title) then
      continue;
    end if;

    begin
      for action in select jsonb_array_elements(coalesce(rule_rec.actions, '[]'::jsonb))
      loop
        if action->>'type' = 'move_to_column' then
          update tasks set column_id = (action->>'column_id')::uuid where id = NEW.id;
        elsif action->>'type' = 'set_field' then
          if action->>'field' not in ('priority', 'tag', 'assignee_name') then
            raise exception 'campo no permitido: %', action->>'field';
          end if;
          execute format('update tasks set %I = $1 where id = $2', action->>'field')
            using (action->>'value'), NEW.id;
        elsif action->>'type' = 'add_comment' then
          insert into comments(task_id, author_id, body, source)
            values (NEW.id, null, action->>'body', 'automation');
        elsif action->>'type' = 'webhook' then
          if not is_safe_webhook_url(action->>'url') then
            raise exception 'la url del webhook no es válida (debe ser https y no apuntar a una red privada)';
          end if;
          perform net.http_post(
            url := action->>'url',
            body := jsonb_build_object(
              'event', event_type,
              'rule_id', rule_rec.id,
              'rule_name', rule_rec.name,
              'task_id', NEW.id,
              'task_title', NEW.title,
              'occurred_at', now()
            ),
            headers := jsonb_build_object('Content-Type', 'application/json')
          );
        elsif action->>'type' = 'crm_sync' then
          select * into v_integration from integrations
            where id = (action->>'integration_id')::uuid
              and tenant_id = NEW.tenant_id
              and provider = 'crm_generic'
              and is_active;

          if v_integration.id is null then
            raise exception 'integración crm_generic % no encontrada o inactiva', action->>'integration_id';
          end if;

          v_secret := get_crm_credential(NEW.tenant_id);
          if v_secret is null then
            raise exception 'la integración crm_generic % no tiene un secreto configurado', v_integration.id;
          end if;

          v_is_create := NEW.external_ticket_id is null;
          v_url := v_integration.config->>'base_url';
          if v_is_create then
            v_url := v_url || (v_integration.config->>'create_endpoint');
          else
            v_url := v_url || replace(v_integration.config->>'update_endpoint', '{external_id}', NEW.external_ticket_id);
          end if;

          if not is_safe_webhook_url(v_url) then
            raise exception 'la url del CRM no es válida (debe ser https y no apuntar a una red privada)';
          end if;

          v_mapping := coalesce(v_integration.config->'field_mapping', '{}'::jsonb);
          v_body := '{}'::jsonb;
          for v_key, v_field in select * from jsonb_each_text(v_mapping)
          loop
            v_mapped_value := case v_key
              when 'title' then to_jsonb(NEW.title)
              when 'description' then to_jsonb(NEW.description)
              when 'priority' then to_jsonb(NEW.priority)
              when 'column_title' then to_jsonb((select title from board_columns where id = NEW.column_id))
              else null
            end;
            -- Clave de field_mapping no reconocida (v_key fuera de los 4
            -- soportados): se omite en vez de mandar `null` al CRM, que
            -- podría borrar un campo válido del lado del CRM sin querer.
            if v_key in ('title', 'description', 'priority', 'column_title') then
              v_body := v_body || jsonb_build_object(v_field, v_mapped_value);
            end if;
          end loop;

          v_headers := jsonb_build_object('Content-Type', 'application/json')
            || jsonb_build_object(coalesce(v_integration.config->>'auth_header', 'Authorization'), v_secret);

          -- pg_net no soporta PATCH/PUT en este proyecto (verificado: solo
          -- http_get/http_post/http_delete) — se usa POST tanto para crear
          -- como para actualizar.
          select (net.http_post(url := v_url, body := v_body, headers := v_headers)).id into v_request_id;

          if v_is_create then
            insert into crm_sync_requests (request_id, task_id, tenant_id, response_id_field)
            values (v_request_id, NEW.id, NEW.tenant_id, coalesce(v_integration.config->>'response_id_field', 'id'));
          end if;
        end if;
      end loop;

      insert into automation_executions(rule_id, task_id, status) values (rule_rec.id, NEW.id, 'success');
    exception when others then
      insert into automation_executions(rule_id, task_id, status, error_message)
        values (rule_rec.id, NEW.id, 'error', SQLERRM);
    end;
  end loop;

  return new;
end;
$function$;
