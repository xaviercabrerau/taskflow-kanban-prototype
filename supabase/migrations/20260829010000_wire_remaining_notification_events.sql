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

-- ============================================================
-- 2. due_soon — extend the existing hourly cron function to
-- also fire the email webhook (in-app insert + dedup guard
-- already exist; this only adds the webhook call).
-- ============================================================
create or replace function public.check_due_soon_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t_rec record;
  notify_secret text;
begin
  select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';

  for t_rec in
    select t.*
    from public.tasks t
    where t.due_date is not null
      and t.due_date between now() and now() + interval '24 hours'
      and t.due_soon_notified_at is null
      and t.created_by is not null
  loop
    begin
      insert into public.notifications (tenant_id, user_id, type, title, body, related_task_id)
      values (t_rec.tenant_id, t_rec.created_by, 'due_soon', 'Tarea próxima a vencer',
              format('"%s" vence el %s', t_rec.title, to_char(t_rec.due_date, 'DD Mon YYYY')),
              t_rec.id);

      update public.tasks
      set due_soon_notified_at = now()
      where id = t_rec.id;

      if notify_secret is not null then
        perform net.http_post(
          url := 'https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event',
          body := jsonb_build_object(
            'eventType', 'due_soon',
            'userId', t_rec.created_by,
            'organizationId', t_rec.tenant_id,
            'taskId', t_rec.id,
            'channels', jsonb_build_array('email'),
            'data', jsonb_build_object('taskTitle', t_rec.title, 'dueDate', t_rec.due_date)
          ),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
        );
      end if;
    exception when others then
      insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
      values (t_rec.tenant_id, null, 'cron', 'check_due_soon_tasks_error', 'task', t_rec.id,
              jsonb_build_object('error', SQLERRM));
    end;
  end loop;
end;
$function$;

-- NOTE (discovered during live verification of task_completed): as with
-- task_assigned in task 1, the notifications_type_check constraint did not
-- yet allow type='task_completed'. Widening additively again, same
-- pattern, keeping every previously allowed value.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['assigned'::text, 'mentioned'::text, 'due_soon'::text, 'status_changed'::text, 'task_assigned'::text, 'task_completed'::text]));

-- ============================================================
-- 3. task_completed — fires when a task's column changes into
-- a done-state column (and wasn't already in one). Notifies
-- assignees, distinct from status_changed which notifies the
-- creator on any column move.
-- ============================================================
create or replace function public.notify_task_completed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  was_done boolean;
  is_done boolean;
  assignee_id uuid;
  notify_secret text;
begin
  if new.column_id is distinct from old.column_id then
    select is_done_state into is_done from board_columns where id = new.column_id;
    select is_done_state into was_done from board_columns where id = old.column_id;

    if coalesce(is_done, false) and not coalesce(was_done, false) then
      select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';

      for assignee_id in
        select ta.user_id from task_assignees ta where ta.task_id = new.id
      loop
        if assignee_id is distinct from actor then
          insert into notifications (tenant_id, user_id, type, title, body, related_task_id, actor_id)
          values (
            new.tenant_id,
            assignee_id,
            'task_completed',
            'Tarea completada',
            format('"%s" se marcó como completada', new.title),
            new.id,
            actor
          );

          if notify_secret is not null then
            perform net.http_post(
              url := 'https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event',
              body := jsonb_build_object(
                'eventType', 'task_completed',
                'userId', assignee_id,
                'organizationId', new.tenant_id,
                'taskId', new.id,
                'actorId', actor,
                'channels', jsonb_build_array('email'),
                'data', jsonb_build_object('taskTitle', new.title)
              ),
              headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
            );
          end if;
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists tasks_notify_completed on tasks;
create trigger tasks_notify_completed
  after update on tasks
  for each row execute function public.notify_task_completed();

-- NOTE (discovered during live verification of comment_added): as with
-- task_assigned and task_completed, the notifications_type_check
-- constraint did not yet allow type='comment_added'. Widening
-- additively again, same pattern, keeping every previously allowed
-- value.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['assigned'::text, 'mentioned'::text, 'due_soon'::text, 'status_changed'::text, 'task_assigned'::text, 'task_completed'::text, 'comment_added'::text]));

-- ============================================================
-- 4. comment_added (general) — fires for the task's creator +
-- assignees, excluding the author and anyone already notified
-- via @mention on this same comment (notify_comment_mentions
-- handles those separately).
-- ============================================================
create or replace function public.notify_comment_added()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  task_rec record;
  recipient_id uuid;
  actor uuid := auth.uid();
  actor_name text;
  notify_secret text;
  already_mentioned uuid[] := coalesce(NEW.mentioned_user_ids, array[]::uuid[]);
begin
  select t.id, t.tenant_id, t.title, t.created_by into task_rec from tasks t where t.id = NEW.task_id;
  if task_rec.id is null then
    return NEW;
  end if;

  select full_name into actor_name from profiles where id = actor;
  select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';

  for recipient_id in
    select distinct uid from (
      select task_rec.created_by as uid
      union
      select ta.user_id from task_assignees ta where ta.task_id = task_rec.id
    ) recipients
    where uid is not null
  loop
    if recipient_id is distinct from actor
      and recipient_id is distinct from NEW.author_id
      and not (recipient_id = any(already_mentioned))
    then
      insert into notifications (tenant_id, user_id, type, title, body, related_task_id, actor_id)
      values (
        task_rec.tenant_id,
        recipient_id,
        'comment_added',
        'Nuevo comentario',
        format('%s comentó en "%s"', coalesce(actor_name, 'Alguien'), task_rec.title),
        task_rec.id,
        actor
      );

      if notify_secret is not null then
        perform net.http_post(
          url := 'https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event',
          body := jsonb_build_object(
            'eventType', 'comment_added',
            'userId', recipient_id,
            'organizationId', task_rec.tenant_id,
            'taskId', task_rec.id,
            'actorId', actor,
            'channels', jsonb_build_array('email'),
            'data', jsonb_build_object(
              'taskTitle', task_rec.title,
              'actorName', coalesce(actor_name, 'Alguien'),
              'commentText', left(NEW.body, 500)
            )
          ),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
        );
      end if;
    end if;
  end loop;

  return NEW;
end;
$function$;

drop trigger if exists comments_notify_added on comments;
create trigger comments_notify_added
  after insert on comments
  for each row execute function public.notify_comment_added();

-- NOTE (discovered during live verification of task 5): as with the
-- prior four events, the notifications_type_check constraint did not
-- yet allow type='member_invited'. Widening additively again, same
-- pattern, keeping every previously allowed value.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['assigned'::text, 'mentioned'::text, 'due_soon'::text, 'status_changed'::text, 'task_assigned'::text, 'task_completed'::text, 'comment_added'::text, 'member_invited'::text]));

-- ============================================================
-- 5. member_invited — fires for any new membership row that
-- isn't the org-bootstrap owner row (the only 'owner' row ever
-- inserted comes from the atomic org-creation RPC, not a real
-- invite).
-- ============================================================
create or replace function public.notify_member_invited()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  actor uuid := coalesce(NEW.invited_by, auth.uid());
  actor_name text;
  notify_secret text;
begin
  if NEW.org_role != 'owner' then
    select full_name into actor_name from profiles where id = actor;

    insert into notifications (tenant_id, user_id, type, title, body, actor_id)
    values (
      NEW.organization_id,
      NEW.user_id,
      'member_invited',
      'Te invitaron a una organización',
      format('%s te invitó a unirte', coalesce(actor_name, 'Alguien')),
      actor
    );

    select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
    if notify_secret is not null then
      perform net.http_post(
        url := 'https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event',
        body := jsonb_build_object(
          'eventType', 'member_invited',
          'userId', NEW.user_id,
          'organizationId', NEW.organization_id,
          'actorId', actor,
          'channels', jsonb_build_array('email'),
          'data', jsonb_build_object('actorName', coalesce(actor_name, 'Alguien'))
        ),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
      );
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists org_members_notify_invited on organization_members;
create trigger org_members_notify_invited
  after insert on organization_members
  for each row execute function public.notify_member_invited();

-- NOTE (discovered during live verification of task 6): as with the prior
-- five events, the notifications_type_check constraint did not yet allow
-- type='project_created'. Widening additively again, same pattern, keeping
-- every previously allowed value.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['assigned'::text, 'mentioned'::text, 'due_soon'::text, 'status_changed'::text, 'task_assigned'::text, 'task_completed'::text, 'comment_added'::text, 'member_invited'::text, 'project_created'::text]));

-- ============================================================
-- 6. project_created — fires for org owners/admins (not every
-- member) when a new board is created, excluding the creator.
-- ============================================================
create or replace function public.notify_project_created()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  admin_id uuid;
  actor uuid := coalesce(NEW.created_by, auth.uid());
  actor_name text;
  notify_secret text;
begin
  select full_name into actor_name from profiles where id = actor;
  select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';

  for admin_id in
    select om.user_id from organization_members om
    where om.organization_id = NEW.tenant_id
      and om.org_role in ('owner', 'admin')
  loop
    if admin_id is distinct from actor then
      insert into notifications (tenant_id, user_id, type, title, body, actor_id)
      values (
        NEW.tenant_id,
        admin_id,
        'project_created',
        'Nuevo proyecto',
        format('Se creó el proyecto "%s"', NEW.name),
        actor
      );

      if notify_secret is not null then
        perform net.http_post(
          url := 'https://taskflow-kanban-prototype-xaviercabrerau-1550s-projects.vercel.app/api/internal/notify-event',
          body := jsonb_build_object(
            'eventType', 'project_created',
            'userId', admin_id,
            'organizationId', NEW.tenant_id,
            'actorId', actor,
            'channels', jsonb_build_array('email'),
            'data', jsonb_build_object('projectName', NEW.name, 'actorName', coalesce(actor_name, 'Alguien'))
          ),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
        );
      end if;
    end if;
  end loop;

  return NEW;
end;
$function$;

drop trigger if exists boards_notify_created on boards;
create trigger boards_notify_created
  after insert on boards
  for each row execute function public.notify_project_created();
