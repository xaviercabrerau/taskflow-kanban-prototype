drop policy if exists metrics_snapshots_all on metrics_snapshots;

create policy metrics_snapshots_select on metrics_snapshots
  for select
  using (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_member(b.tenant_id)));

create policy metrics_snapshots_write on metrics_snapshots
  for all
  using (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_owner(b.tenant_id)))
  with check (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_owner(b.tenant_id)));

alter table metrics_snapshots
  add constraint metrics_snapshots_board_metric_date_key unique (board_id, metric_type, snapshot_date);

create or replace function record_daily_metrics_snapshot(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_throughput integer;
  v_avg_hours numeric;
  v_cycle_count integer;
begin
  select tenant_id into v_tenant_id from boards where id = p_board_id;
  if v_tenant_id is null or not is_org_member(v_tenant_id) then
    raise exception 'No autorizado para este board';
  end if;

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
    perform record_daily_metrics_snapshot(v_board.id);
  end loop;
end;
$$;

select cron.schedule('record-daily-metrics-snapshots', '10 3 * * *', 'select public.record_daily_metrics_snapshot_all_boards();');
