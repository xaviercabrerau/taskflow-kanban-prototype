-- Observability: expose pg_cron job health to the app without shipping a
-- service-role key to a serverless function. `cron.job_run_details` lives in
-- the `cron` schema, which is not exposed to PostgREST and is unreadable by
-- the anon/authenticated roles by default. Rather than granting broad
-- read access to the `cron` schema (or handing the app a service-role key,
-- which would be able to bypass every RLS policy in the project, not just
-- read cron history), we wrap the narrow read we actually need in a
-- SECURITY DEFINER function and grant EXECUTE on it to `authenticated` only.
-- The function itself hardcodes which jobs it reports on and never accepts
-- caller-supplied SQL, so it cannot be used to read arbitrary cron/job data.
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
      ('check_due_soon_tasks', 'hourly', interval '2 hours'),
      ('execute_due_date_automations', 'hourly', interval '2 hours'),
      ('purge_expired_audit_logs', 'daily', interval '26 hours'),
      ('record_daily_metrics_snapshot_all_boards', 'daily', interval '26 hours')
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

-- Only the authenticated app (e.g. an internal monitoring dashboard route
-- hit by a signed-in admin, or a cron-triggered health-check request using
-- a user session) may call this. Never grant to anon: cron run history
-- can hint at internal job names/timing and isn't meant to be public.
revoke execute on function public.get_cron_health() from public, anon;
grant execute on function public.get_cron_health() to authenticated;
