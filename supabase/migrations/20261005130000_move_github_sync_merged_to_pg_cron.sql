-- Mueve el cron de github-sync-merged de Vercel Cron a pg_cron.
--
-- vercel.json lo declaraba con '*/15 * * * *', pero el plan Hobby de Vercel
-- solo admite crons que corran una vez al día: con esa expresión el
-- despliegue FALLA al validar la configuración (check "Vercel" del PR #1), y
-- ningún despliegue nuevo de main podría publicarse. pg_cron ya ejecuta los
-- otros jobs del proyecto (taskflow_*, record-*, purge-*) sin ese límite.
--
-- La ruta /api/cron/github-sync-merged no cambia: sigue autenticándose con
-- Authorization: Bearer <CRON_SECRET>. Este job lee ese mismo valor del secreto
-- de Vault llamado 'cron_secret', que HAY QUE CREAR a mano con el mismo valor
-- que CRON_SECRET en Vercel (igual que 'internal_notify_secret'). Si falta, el
-- job avisa con un WARNING y no llama a nada.

create or replace function public.call_github_sync_merged()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cron_secret text;
begin
  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if v_cron_secret is null then
    raise warning 'cron_secret no existe en Vault: no se llama a github-sync-merged';
    return;
  end if;

  perform net.http_get(
    url := 'https://task.conto.ec/api/cron/github-sync-merged',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_cron_secret),
    timeout_milliseconds := 30000
  );
end;
$$;

-- Solo pg_cron (corre como el dueño de la función) debe poder ejecutarla.
revoke execute on function public.call_github_sync_merged() from public, anon, authenticated;

-- Reprogramación idempotente: si el job ya existe se reemplaza.
select cron.unschedule('taskflow_github_sync_merged')
where exists (select 1 from cron.job where jobname = 'taskflow_github_sync_merged');

select cron.schedule(
  'taskflow_github_sync_merged',
  '*/15 * * * *',
  'select public.call_github_sync_merged();'
);

-- Monitoreo: registra el job en get_cron_health desde el día uno (mismo
-- patrón que 20260914004001). Debe coincidir con MONITORED_JOBS en
-- src/lib/cron-jobs.ts. Ventana de 45 min = 3 ejecuciones de margen.
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
      ('taskflow_resolve_crm_sync_responses', 'every_minute', interval '10 minutes'),
      ('record-sprint-burndown-snapshots', 'daily', interval '26 hours'),
      ('taskflow_github_sync_merged', 'every_15_minutes', interval '45 minutes')
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
