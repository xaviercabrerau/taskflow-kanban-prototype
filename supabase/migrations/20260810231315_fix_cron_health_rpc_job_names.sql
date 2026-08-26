-- La migración anterior (cron_health_rpc) usó nombres de job incorrectos
-- (derivados del texto de la función invocada, no del jobname real en
-- cron.job), por lo que get_cron_health() siempre reportaba is_stale=true
-- para los 4 jobs aunque todos corren correctamente. Los nombres reales son:
-- taskflow_check_due_soon_tasks, taskflow_execute_due_date_automations,
-- purge-expired-audit-logs, record-daily-metrics-snapshots.
create or replace function public.get_cron_health()
returns table (
  job_name text,
  expected_interval text,
  last_run_at timestamptz,
  last_status text,
  is_stale boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with monitored_jobs (job_name, expected_interval, max_age) as (
    values
      ('taskflow_check_due_soon_tasks', 'hourly', interval '2 hours'),
      ('taskflow_execute_due_date_automations', 'hourly', interval '2 hours'),
      ('purge-expired-audit-logs', 'daily', interval '26 hours'),
      ('record-daily-metrics-snapshots', 'daily', interval '26 hours')
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
$$;
