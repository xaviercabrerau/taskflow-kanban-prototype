-- record_sprint_burndown_snapshot() y record_sprint_burndown_snapshot_all_active()
-- (20260914003951_sprint_burndown_snapshots.sql) quedaron ejecutables por
-- anon/authenticated sin chequeo de autorización — mismo patrón de
-- vulnerabilidad ya encontrado y corregido para las funciones hermanas
-- record_daily_metrics_snapshot / record_daily_metrics_snapshot_all_boards
-- (m48/m49). Se agrega aquí el mismo chequeo is_org_member() y se revocan
-- los grants abiertos, dejando _all_active() exclusivamente para el cron.
create or replace function record_sprint_burndown_snapshot(p_sprint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id uuid;
  v_tenant_id uuid;
  v_total integer;
  v_remaining integer;
begin
  select board_id into v_board_id from sprints where id = p_sprint_id;
  if v_board_id is null then
    return;
  end if;

  select tenant_id into v_tenant_id from boards where id = v_board_id;
  if v_tenant_id is null or not is_org_member(v_tenant_id) then
    raise exception 'No autorizado para este sprint';
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

revoke execute on function record_sprint_burndown_snapshot(uuid) from public, anon;
grant execute on function record_sprint_burndown_snapshot(uuid) to authenticated;

-- Exclusivo para el cron (pg_cron corre como el dueño de la función,
-- SECURITY DEFINER) — no debe ser invocable directamente por ningún rol
-- de API, igual que record_daily_metrics_snapshot_all_boards() en m49.
revoke execute on function record_sprint_burndown_snapshot_all_active() from public, anon, authenticated;
