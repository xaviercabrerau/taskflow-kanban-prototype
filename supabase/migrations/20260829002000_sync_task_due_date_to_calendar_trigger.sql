-- Fires the Google Calendar sync (src/lib/google/calendar.ts, via
-- /api/internal/sync-calendar-event) whenever a task's due_date changes.
-- Same net.http_post + shared-secret pattern already used for
-- notify_comment_mentions/notify_task_status_changed. No-ops safely if
-- Google isn't connected for the org (the route itself checks that).

create or replace function public.notify_task_due_date_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  notify_secret text;
begin
  if TG_OP = 'UPDATE' and NEW.due_date is not distinct from OLD.due_date then
    return NEW;
  end if;

  select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
  if notify_secret is null then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://task.conto.ec/api/internal/sync-calendar-event',
    body := jsonb_build_object(
      'tenantId', NEW.tenant_id,
      'taskId', NEW.id,
      'taskTitle', NEW.title,
      'dueDate', NEW.due_date,
      'taskUrl', 'https://task.conto.ec/orgs/' || NEW.tenant_id || '/tasks/' || NEW.id
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
  );

  return NEW;
end;
$function$;

drop trigger if exists tasks_due_date_calendar_sync on public.tasks;
create trigger tasks_due_date_calendar_sync
  after insert or update of due_date on public.tasks
  for each row execute function public.notify_task_due_date_changed();
