create or replace function record_daily_metrics_snapshot_core(p_board_id uuid)
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
  on conflict (board_id, metric_type, snapshot_date)
  do update set value = excluded.value;

  insert into metrics_snapshots (board_id, metric_type, snapshot_date, value)
  values (p_board_id, 'cycle_time', current_date, jsonb_build_object('avg_hours', round(v_avg_hours, 1), 'task_count', v_cycle_count))
  on conflict (board_id, metric_type, snapshot_date)
  do update set value = excluded.value;
end;
$$;

revoke execute on function record_daily_metrics_snapshot_core(uuid) from public, anon, authenticated;

create or replace function record_daily_metrics_snapshot(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id from boards where id = p_board_id;
  if v_tenant_id is null or not is_org_member(v_tenant_id) then
    raise exception 'No autorizado para este board';
  end if;
  perform record_daily_metrics_snapshot_core(p_board_id);
end;
$$;

grant execute on function record_daily_metrics_snapshot(uuid) to authenticated;

create or replace function record_daily_metrics_snapshot_all_boards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board record;
begin
  for v_board in select id from boards loop
    perform record_daily_metrics_snapshot_core(v_board.id);
  end loop;
end;
$$;

revoke execute on function record_daily_metrics_snapshot_all_boards() from public, anon, authenticated;
