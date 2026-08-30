-- Wires the remaining 6 notification event types (task_assigned, due_soon,
-- comment_added, project_created, member_invited, task_completed) to the
-- same email-webhook pattern already used by notify_comment_mentions and
-- notify_task_status_changed (see
-- 20260828190100_wire_email_notifications_via_triggers.sql): insert the
-- in-app row directly, then fire an async net.http_post to
-- /api/internal/notify-event with channels=['email'] for the email side.
-- See docs/superpowers/specs/2026-08-29-notification-event-wiring-design.md.
--
-- NOTE (discovered during live verification of task_assigned): the existing
-- notifications_type_check constraint only allowed
-- ('assigned','mentioned','due_soon','status_changed') — inserting
-- type='task_assigned' as specified by the design violated it on every real
-- row. Widening the constraint here to admit 'task_assigned' so this
-- section actually works; the same fix will be needed for the other new
-- type values ('task_completed', 'comment_added', 'project_created',
-- 'member_invited') as tasks 2-6 land in this same file.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['assigned'::text, 'mentioned'::text, 'due_soon'::text, 'status_changed'::text, 'task_assigned'::text]));

-- ============================================================
-- 1. task_assigned — fires when a user is assigned to a task
-- ============================================================
create or replace function public.notify_task_assigned()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  task_rec record;
  actor uuid := auth.uid();
  actor_name text;
  notify_secret text;
begin
  if NEW.user_id is distinct from actor then
    select t.id, t.tenant_id, t.title into task_rec from tasks t where t.id = NEW.task_id;
    if task_rec.id is null then
      return NEW;
    end if;

    select full_name into actor_name from profiles where id = actor;

    insert into notifications (tenant_id, user_id, type, title, body, related_task_id, actor_id)
    values (
      task_rec.tenant_id,
      NEW.user_id,
      'task_assigned',
      'Te asignaron una tarea',
      format('%s te asignó "%s"', coalesce(actor_name, 'Alguien'), task_rec.title),
      task_rec.id,
      actor
    );

    select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
    if notify_secret is not null then
      perform net.http_post(
        url := 'https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event',
        body := jsonb_build_object(
          'eventType', 'task_assigned',
          'userId', NEW.user_id,
          'organizationId', task_rec.tenant_id,
          'taskId', task_rec.id,
          'actorId', actor,
          'channels', jsonb_build_array('email'),
          'data', jsonb_build_object('taskTitle', task_rec.title, 'actorName', coalesce(actor_name, 'Alguien'))
        ),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
      );
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists task_assignees_notify_assigned on task_assignees;
create trigger task_assignees_notify_assigned
  after insert on task_assignees
  for each row execute function public.notify_task_assigned();
