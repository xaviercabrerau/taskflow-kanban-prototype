-- metrics_snapshots_metric_type_check (m3_notifications_automations_metrics)
-- solo permite 'velocity','burndown','cycle_time','throughput' — se agrega
-- 'sprint_burndown' como nuevo metric_type para snapshots diarios por sprint.
alter table metrics_snapshots
  drop constraint metrics_snapshots_metric_type_check;

alter table metrics_snapshots
  add constraint metrics_snapshots_metric_type_check
  check (metric_type in ('velocity', 'burndown', 'cycle_time', 'throughput', 'sprint_burndown'));

-- metrics_snapshots_board_metric_date_key (board_id, metric_type,
-- snapshot_date) no alcanza para burndown: un board puede tener más de
-- un sprint activo el mismo día. Se agrega un índice único parcial
-- adicional, específico para metric_type = 'sprint_burndown', scopeado
-- por sprint_id en vez de board_id.
create unique index metrics_snapshots_sprint_burndown_key
  on metrics_snapshots (sprint_id, snapshot_date)
  where metric_type = 'sprint_burndown';

create or replace function record_sprint_burndown_snapshot(p_sprint_id uuid)
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

grant execute on function record_sprint_burndown_snapshot(uuid) to authenticated;

create or replace function record_sprint_burndown_snapshot_all_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint record;
begin
  for v_sprint in select id from sprints where status = 'active' loop
    perform record_sprint_burndown_snapshot(v_sprint.id);
  end loop;
end;
$$;

grant execute on function record_sprint_burndown_snapshot_all_active() to authenticated;

select cron.schedule('record-sprint-burndown-snapshots', '0 1 * * *', 'select public.record_sprint_burndown_snapshot_all_active();');
