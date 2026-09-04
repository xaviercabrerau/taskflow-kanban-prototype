-- Opción 3 del diseño de integración CRM (docs/plans/2026-09-03-crm-integration-design.md):
-- adaptador propio `crm_generic`. Agrega el provider, un accesor de credencial
-- en Vault (mismo patrón que get_github_token/get_ai_credential), la acción
-- de automatización `crm_sync`, y la resolución asíncrona del id de ticket
-- creado (pg_net es asíncrono: net.http_post no devuelve el body de la
-- respuesta directamente, así que se registra el request_id y un cron corto
-- lo resuelve en cuanto pg_net recibe la respuesta).
--
-- Limitación conocida: la extensión pg_net de este proyecto solo expone
-- http_get/http_post/http_delete (verificado en vivo), no http_patch/http_put.
-- Tanto la creación como la actualización de tickets se envían con POST —
-- si el CRM exige un verbo PATCH estricto para actualizar, se puede agregar
-- un header de method-override configurable en integrations.config más
-- adelante; no se especula esa solución aquí.

alter table integrations drop constraint integrations_provider_check;
alter table integrations add constraint integrations_provider_check
  check (provider = any (array['slack','teams','zoom','n8n','openai','anthropic','github','resend','gmail_inbound','google','crm_generic']));

-- Accesor server-only del secreto del CRM — revocado de anon/authenticated,
-- solo invocable desde una función SECURITY DEFINER propiedad de postgres
-- (como execute_automation_rules más abajo), igual que get_github_token.
create or replace function public.get_crm_credential(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret_id uuid;
  v_token text;
begin
  select credentials_enc::uuid into v_secret_id
  from integrations
  where tenant_id = p_tenant_id and provider = 'crm_generic' and is_active = true;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$function$;

revoke all on function public.get_crm_credential(uuid) from public, anon, authenticated;

-- Registro de llamadas salientes de creación en curso — net.http_post es
-- asíncrono (devuelve un request_id, no el body de la respuesta), así que
-- se necesita esta tabla puente para que resolve_crm_sync_responses() sepa
-- qué tarea y qué campo del body del CRM contiene el id del ticket creado.
-- Solo se usa para creaciones (external_ticket_id nuevo); las actualizaciones
-- no necesitan capturar ningún id.
create table crm_sync_requests (
  request_id bigint primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  tenant_id uuid not null references organizations(id) on delete cascade,
  response_id_field text not null default 'id',
  created_at timestamptz not null default now()
);

alter table crm_sync_requests enable row level security;
create policy crm_sync_requests_select on crm_sync_requests for select using (is_org_member(tenant_id));

-- Extiende el motor de automatizaciones en tiempo real con la acción
-- `crm_sync` — mismo trigger/función que ya ejecuta move_to_column/set_field/
-- add_comment/webhook. Forma de la acción en automation_rules.actions:
--   { "type": "crm_sync", "integration_id": "<uuid de integrations>" }
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

  -- Anti-loop (Sección 3 del diseño): si esta fila fue actualizada hace
  -- menos de 5s por un webhook entrante del CRM, no reenviar el eco.
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
            v_body := v_body || jsonb_build_object(
              v_field,
              case v_key
                when 'title' then to_jsonb(NEW.title)
                when 'description' then to_jsonb(NEW.description)
                when 'priority' then to_jsonb(NEW.priority)
                when 'column_title' then to_jsonb((select title from board_columns where id = NEW.column_id))
                else null
              end
            );
          end loop;

          v_secret := get_crm_credential(NEW.tenant_id);
          v_headers := jsonb_build_object('Content-Type', 'application/json');
          if v_secret is not null then
            v_headers := v_headers || jsonb_build_object(coalesce(v_integration.config->>'auth_header', 'Authorization'), v_secret);
          end if;

          -- pg_net no soporta PATCH/PUT en este proyecto (verificado: solo
          -- http_get/http_post/http_delete) — se usa POST tanto para crear
          -- como para actualizar. Ver nota al inicio del archivo.
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

-- Cron corto (cada minuto — pg_cron corre dentro de Postgres, no depende
-- del plan de Vercel) que resuelve el id de ticket devuelto por el CRM al
-- crear uno nuevo, y limpia filas ya resueltas o con más de 1 hora sin
-- respuesta (evita crecimiento sin límite si el CRM nunca contesta).
create or replace function public.resolve_crm_sync_responses()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req record;
  resp record;
  v_id text;
begin
  for req in select * from crm_sync_requests loop
    select * into resp from net._http_response where id = req.request_id;

    if resp.id is not null then
      if resp.status_code between 200 and 299 then
        v_id := resp.content::jsonb ->> req.response_id_field;
        if v_id is not null then
          update tasks set external_ticket_id = v_id where id = req.task_id;
        end if;
      end if;
      delete from crm_sync_requests where request_id = req.request_id;
    elsif req.created_at < now() - interval '1 hour' then
      delete from crm_sync_requests where request_id = req.request_id;
    end if;
  end loop;
end;
$function$;

select cron.schedule('taskflow_resolve_crm_sync_responses', '* * * * *', $$select public.resolve_crm_sync_responses()$$);

-- Registra el nuevo cron en el sistema de monitoreo desde el día uno —
-- taskflow_execute_recurring_tasks quedó invisible para este mismo sistema
-- por omitirlo aquí (AUDITORIA_2026-09-03.md, hallazgo 3); no se repite.
-- Debe coincidir con MONITORED_JOBS en src/lib/cron-jobs.ts.
create or replace function public.get_cron_health()
 returns table(job_name text, expected_interval text, last_run_at timestamp with time zone, last_status text, is_stale boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      ('record-daily-metrics-snapshots', 'daily', interval '26 hours'),
      ('taskflow_resolve_crm_sync_responses', 'every_minute', interval '10 minutes')
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
$function$;
