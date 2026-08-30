-- Two bugs found by an independent code review of this session's own audit
-- fixes:
--
-- 1. is_safe_webhook_url's host-extraction regex `[^/:]+` stops at the first
--    colon, so a bracketed IPv6 host like `[::1]` truncates to just `[`
--    before any private/loopback check runs — the explicit `[::1]` guard was
--    dead code, and `https://[::1]:8080/...` was classified as safe. Fixed
--    by extracting a bracketed host separately.
-- 2. notify_task_completed/notify_comment_added/notify_project_created had
--    their vault secret lookup accidentally moved from once-before-the-loop
--    to once-per-recipient-iteration when exception handling was added in
--    20260830150200 — restoring it to once-before-the-loop, matching
--    check_due_soon_tasks's own pattern (which this migration's own comment
--    claimed to follow) and avoiding a partial/inconsistent secret read
--    across recipients of the same event.
create or replace function public.is_safe_webhook_url(url text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  host text;
begin
  if url is null or url !~* '^https://' then
    return false;
  end if;
  -- Bracketed IPv6 host (e.g. https://[::1]:8080/...) vs. a plain
  -- hostname/IPv4 host (e.g. https://example.com:443/...).
  if url ~ '^https://\[' then
    host := lower(substring(url from '^https://(\[[0-9a-fA-F:]+\])'));
  else
    host := lower(substring(url from '^https://([^/:]+)'));
  end if;
  if host is null or host = '' then
    return false;
  end if;
  if host = 'localhost' or host = '0.0.0.0' or host = '[::1]' then
    return false;
  end if;
  if host ~ '^(127\.|10\.|192\.168\.|169\.254\.)' then
    return false;
  end if;
  if host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.' then
    return false;
  end if;
  if host ~ '^\[(fe80|fc|fd)' then
    return false;
  end if;
  return true;
end;
$$;

-- Third bug found by the same review: check_due_soon_tasks wraps the
-- notification insert + due_soon_notified_at update in the SAME
-- begin/exception block as the net.http_post call, so a webhook failure
-- rolls back the already-"succeeded" DB writes too (PL/pgSQL's implicit
-- savepoint semantics). Splitting the http_post into its own nested
-- begin/exception so a webhook failure can no longer undo the DB writes.
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

      begin
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
        values (t_rec.tenant_id, null, 'cron', 'check_due_soon_tasks_webhook_error', 'task', t_rec.id,
                jsonb_build_object('error', SQLERRM));
      end;
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

          begin
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
          exception when others then
            insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
            values (new.tenant_id, actor, 'trigger', 'notify_task_completed_error', 'task', new.id,
                    jsonb_build_object('error', SQLERRM));
          end;
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

      begin
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
      exception when others then
        insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
        values (task_rec.tenant_id, actor, 'trigger', 'notify_comment_added_error', 'task', task_rec.id,
                jsonb_build_object('error', SQLERRM));
      end;
    end if;
  end loop;

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

      begin
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
      exception when others then
        insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
        values (NEW.tenant_id, actor, 'trigger', 'notify_project_created_error', 'board', NEW.id,
                jsonb_build_object('error', SQLERRM));
      end;
    end if;
  end loop;

  return NEW;
end;
$function$;
