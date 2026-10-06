-- Migración correctiva (revisión de 2026-10-05). Tres arreglos:
--
--   1. El cron de burndown fallaba siempre: record_sprint_burndown_snapshot_all_active()
--      llamaba a record_sprint_burndown_snapshot(), que desde 20260914004747
--      exige is_org_member() — y bajo pg_cron auth.uid() es NULL, así que lanzaba
--      "No autorizado" en el primer sprint y no se guardaba ningún snapshot.
--      Se aplica el mismo patrón de m49: función _core sin chequeo (revocada a
--      todos los roles de API), un wrapper autorizado para usuarios y el cron
--      llamando directo al _core.
--
--   2. metrics_snapshots_board_metric_date_key (board_id, metric_type,
--      snapshot_date, de m48) impedía dos sprints activos del mismo board el
--      mismo día: el segundo insert de 'sprint_burndown' violaba la constraint
--      y abortaba todo el loop del cron. Pasa a ser un índice único parcial que
--      excluye 'sprint_burndown' (ese tipo ya tiene su propio índice por
--      sprint_id). Como un ON CONFLICT sin predicado no infiere un índice
--      parcial, record_daily_metrics_snapshot_core (m49) se redefine con el
--      predicado.
--
--   3. is_safe_webhook_url() seguía permitiendo SSRF: la autoridad se cortaba
--      solo en '/', no en '?', '#' ni '\', así que https://127.0.0.1?@evil.com
--      se veía como host "evil.com" y un cliente HTTP real conectaba a
--      127.0.0.1. Además aceptaba IPv4 decimal/hex/octal, [::ffff:127.0.0.1],
--      [::], 100.64/10, "localhost." y *.internal/*.local. Ahora se corta la
--      autoridad en [/?#\] y solo se aceptan hostnames DNS con TLD alfabético,
--      lo que descarta cualquier IP literal. NO cubre DNS rebinding (un nombre
--      público que resuelve a IP privada): eso hay que validarlo al resolver,
--      en el worker que hace la petición, no en SQL.

-- ---------------------------------------------------------------------------
-- 2. Constraint de snapshots
-- ---------------------------------------------------------------------------
alter table public.metrics_snapshots
  drop constraint if exists metrics_snapshots_board_metric_date_key;

create unique index if not exists metrics_snapshots_board_metric_date_key
  on public.metrics_snapshots (board_id, metric_type, snapshot_date)
  where metric_type <> 'sprint_burndown';

create or replace function public.record_daily_metrics_snapshot_core(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_throughput integer;
  v_avg_hours numeric;
  v_cycle_count integer;
begin
  select count(*) into v_throughput
  from tasks t
  join board_columns c on c.id = t.column_id
  where t.board_id = p_board_id
    and c.is_done_state = true
    and t.updated_at::date = current_date;

  select count(*), coalesce(avg(extract(epoch from (t.updated_at - t.created_at)) / 3600), 0) into v_cycle_count, v_avg_hours
  from tasks t
  join board_columns c on c.id = t.column_id
  where t.board_id = p_board_id
    and c.is_done_state = true
    and t.updated_at::date = current_date;

  insert into metrics_snapshots (board_id, metric_type, snapshot_date, value)
  values (p_board_id, 'throughput', current_date, jsonb_build_object('count', v_throughput))
  on conflict (board_id, metric_type, snapshot_date) where metric_type <> 'sprint_burndown'
  do update set value = excluded.value;

  insert into metrics_snapshots (board_id, metric_type, snapshot_date, value)
  values (p_board_id, 'cycle_time', current_date, jsonb_build_object('avg_hours', round(v_avg_hours, 1), 'task_count', v_cycle_count))
  on conflict (board_id, metric_type, snapshot_date) where metric_type <> 'sprint_burndown'
  do update set value = excluded.value;
end;
$$;

revoke execute on function public.record_daily_metrics_snapshot_core(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Cron de burndown
-- ---------------------------------------------------------------------------
create or replace function public.record_sprint_burndown_snapshot_core(p_sprint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id uuid;
  v_total integer;
  v_remaining integer;
begin
  select board_id into v_board_id from sprints where id = p_sprint_id;
  if v_board_id is null then
    return;
  end if;

  select count(*) into v_total from tasks where sprint_id = p_sprint_id;

  select count(*) into v_remaining
  from tasks t
  join board_columns c on c.id = t.column_id
  where t.sprint_id = p_sprint_id
    and c.is_done_state = false;

  insert into metrics_snapshots (board_id, metric_type, snapshot_date, sprint_id, value)
  values (v_board_id, 'sprint_burndown', current_date, p_sprint_id,
          jsonb_build_object('total', v_total, 'remaining', v_remaining))
  on conflict (sprint_id, snapshot_date) where metric_type = 'sprint_burndown'
  do update set value = excluded.value;
end;
$$;

revoke execute on function public.record_sprint_burndown_snapshot_core(uuid) from public, anon, authenticated;

create or replace function public.record_sprint_burndown_snapshot(p_sprint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id uuid;
  v_tenant_id uuid;
begin
  select board_id into v_board_id from sprints where id = p_sprint_id;
  if v_board_id is null then
    return;
  end if;

  select tenant_id into v_tenant_id from boards where id = v_board_id;
  if v_tenant_id is null or not is_org_member(v_tenant_id) then
    raise exception 'No autorizado para este sprint';
  end if;

  perform record_sprint_burndown_snapshot_core(p_sprint_id);
end;
$$;

revoke execute on function public.record_sprint_burndown_snapshot(uuid) from public, anon;
grant execute on function public.record_sprint_burndown_snapshot(uuid) to authenticated;

create or replace function public.record_sprint_burndown_snapshot_all_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint record;
begin
  for v_sprint in select id from sprints where status = 'active' loop
    perform record_sprint_burndown_snapshot_core(v_sprint.id);
  end loop;
end;
$$;

revoke execute on function public.record_sprint_burndown_snapshot_all_active() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Validador de URLs de webhook
-- ---------------------------------------------------------------------------
create or replace function public.is_safe_webhook_url(url text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  authority text;
  host text;
begin
  if url is null or url !~* '^https://' then
    return false;
  end if;

  -- Espacios o caracteres de control: los parsers los tratan distinto.
  if url ~ '[[:space:][:cntrl:]]' then
    return false;
  end if;

  -- Autoridad = lo que hay entre 'https://' y el primer '/', '?', '#' o '\'
  -- (los clientes HTTP tratan '\' como '/'). Cortar solo en '/' dejaba pasar
  -- https://127.0.0.1?@evil.com con "evil.com" como host aparente.
  authority := substring(url from '^[hH][tT][tT][pP][sS]://([^/?#\\]*)');
  if authority is null or authority = '' then
    return false;
  end if;

  -- Userinfo: hasta el ÚLTIMO '@', como un parser RFC 3986.
  if authority ~ '@' then
    authority := regexp_replace(authority, '^.*@', '');
  end if;

  -- IP literal entre corchetes (IPv6): nunca se permite en un webhook.
  if authority ~ '^\[' then
    return false;
  end if;

  host := lower(substring(authority from '^([^:]*)'));
  if host is null or host = '' then
    return false;
  end if;

  -- Puerto, si lo hay, solo dígitos.
  if authority ~ ':' and authority !~ '^[^:]+:[0-9]{1,5}$' then
    return false;
  end if;

  -- Solo nombres DNS con TLD alfabético: descarta cualquier IPv4 (decimal,
  -- hex, octal o abreviada como 127.1), 'localhost', y 'host.' con punto final.
  if length(host) > 253
     or host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    return false;
  end if;

  -- Sufijos que nunca son internet pública.
  if host ~ '\.(internal|local|localhost|localdomain|lan|home|corp|intranet|arpa)$' then
    return false;
  end if;

  return true;
end;
$function$;
