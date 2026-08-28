-- The previous migration (wire_email_notifications_via_triggers) hardcoded
-- the auto-generated *project* Vercel URL, which is behind Vercel's
-- Deployment Protection SSO wall and returns a 302 redirect to a login
-- page — net.http_post from these triggers could never actually reach the
-- app. Fixed to use the real custom domain, which is publicly reachable.

create or replace function public.notify_comment_mentions()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  mentioned_id uuid;
  task_rec record;
  actor uuid := auth.uid();
  notify_secret text;
begin
  if NEW.mentioned_user_ids is null or array_length(NEW.mentioned_user_ids, 1) is null then
    return NEW;
  end if;

  select t.id, t.tenant_id, t.title into task_rec from tasks t where t.id = NEW.task_id;
  if task_rec.id is null then
    return NEW;
  end if;

  select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';

  foreach mentioned_id in array NEW.mentioned_user_ids
  loop
    if mentioned_id is distinct from actor
      and exists (
        select 1 from organization_members om
        where om.user_id = mentioned_id and om.organization_id = task_rec.tenant_id
      )
    then
      insert into notifications (tenant_id, user_id, type, title, body, related_task_id, actor_id)
      values (
        task_rec.tenant_id,
        mentioned_id,
        'mentioned',
        'Te mencionaron en un comentario',
        format('En "%s": %s', task_rec.title, left(NEW.body, 140)),
        task_rec.id,
        actor
      );

      if notify_secret is not null then
        perform net.http_post(
          url := 'https://task.conto.ec/api/internal/notify-event',
          body := jsonb_build_object(
            'eventType', 'task_mentioned',
            'userId', mentioned_id,
            'organizationId', task_rec.tenant_id,
            'taskId', task_rec.id,
            'actorId', actor,
            'channels', jsonb_build_array('email'),
            'data', jsonb_build_object('taskTitle', task_rec.title, 'commentText', left(NEW.body, 500))
          ),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
        );
      end if;
    end if;
  end loop;

  return NEW;
end;
$function$;

create or replace function public.notify_task_status_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  new_col_label text;
  notify_secret text;
begin
  if new.column_id is distinct from old.column_id
     and new.created_by is not null
     and new.created_by is distinct from actor
  then
    select label into new_col_label from public.board_columns where id = new.column_id;
    insert into public.notifications (tenant_id, user_id, type, title, body, related_task_id, actor_id)
    values (
      new.tenant_id,
      new.created_by,
      'status_changed',
      'Tu tarea cambió de estado',
      format('"%s" se movió a "%s"', new.title, coalesce(new_col_label, '—')),
      new.id,
      actor
    );

    select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
    if notify_secret is not null then
      perform net.http_post(
        url := 'https://task.conto.ec/api/internal/notify-event',
        body := jsonb_build_object(
          'eventType', 'status_changed',
          'userId', new.created_by,
          'organizationId', new.tenant_id,
          'taskId', new.id,
          'actorId', actor,
          'channels', jsonb_build_array('email'),
          'data', jsonb_build_object('taskTitle', new.title, 'statusAfter', coalesce(new_col_label, '—'))
        ),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', notify_secret)
      );
    end if;
  end if;
  return new;
end;
$function$;
