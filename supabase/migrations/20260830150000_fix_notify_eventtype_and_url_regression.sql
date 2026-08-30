-- Fixes a regression reintroduced by 20260829010000_wire_remaining_notification_events.sql:
-- all 6 new trigger functions (notify_task_assigned, check_due_soon_tasks,
-- notify_task_completed, notify_comment_added, notify_member_invited,
-- notify_project_created) built their net.http_post payload with the key
-- 'eventType' instead of 'type' (validateEvent() in src/lib/notifications/notify.ts
-- reads evt.type) — the exact field-name mismatch already fixed once in
-- 20260828200000_fix_notify_event_field_name_mismatch.sql for the two
-- pre-existing triggers, copy-pasted back in wrong for these six new ones.
-- They also all posted to the stale, SSO-protected Vercel deployment URL
-- instead of https://task.conto.ec, which 20260828190200_fix_notify_webhook_url.sql
-- already fixed for the two pre-existing triggers but never got applied here.
-- Net effect: task_assigned, due_soon, task_completed, comment_added,
-- member_invited, and project_created emails have never sent since they were
-- wired in — every call is silently dropped (wrong URL and/or rejected by
-- validateEvent), while /api/internal/notify-event still returns 200,
-- so nothing surfaced this until a fresh audit re-read the trigger bodies.

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
        url := 'https://task.conto.ec/api/internal/notify-event',
        body := jsonb_build_object(
          'type', 'task_assigned',
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
          url := 'https://task.conto.ec/api/internal/notify-event',
          body := jsonb_build_object(
            'type', 'due_soon',
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
              url := 'https://task.conto.ec/api/internal/notify-event',
              body := jsonb_build_object(
                'type', 'task_completed',
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
          url := 'https://task.conto.ec/api/internal/notify-event',
          body := jsonb_build_object(
            'type', 'comment_added',
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
        url := 'https://task.conto.ec/api/internal/notify-event',
        body := jsonb_build_object(
          'type', 'member_invited',
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
          url := 'https://task.conto.ec/api/internal/notify-event',
          body := jsonb_build_object(
            'type', 'project_created',
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
