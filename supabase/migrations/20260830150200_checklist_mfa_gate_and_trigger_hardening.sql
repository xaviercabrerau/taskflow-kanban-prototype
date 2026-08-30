-- Two hardening fixes found in a comprehensive platform audit:
--
-- 1. task_checklists/task_checklist_items were created (20260812053441)
--    between the app's two MFA/AAL2 defense-in-depth passes
--    (20260811002544 and 20260828180100) and never got wrapped in
--    session_meets_mfa(), unlike every sibling task-scoped table
--    (comments, attachments, tasks, boards, board_columns). An org with
--    mfa_required enabled still lets a non-AAL2 session read/write
--    checklists — closing that gap here to match the established pattern.
--
-- 2. The six new notification triggers added in
--    20260829010000_wire_remaining_notification_events.sql have no
--    exception handling, unlike execute_automation_rules()/
--    execute_due_date_automations()/check_due_soon_tasks()'s per-row loop,
--    which all wrap side-effecting work in begin/exception so a transient
--    failure (e.g. a vault read hiccup, a constraint mismatch) can't abort
--    the *entire* calling transaction. Without this, a bug in a
--    notification side-effect could make an ordinary task assignment,
--    comment, member invite, or board creation fail outright. Wrapping
--    each function's body the same way check_due_soon_tasks already does.

drop policy if exists checklists_all on public.checklists;
create policy checklists_all on public.checklists for all using (
  exists (select 1 from public.tasks t
          where t.id = task_id
            and public.is_org_member(t.tenant_id)
            and public.session_meets_mfa(t.tenant_id))
);

drop policy if exists checklist_items_all on public.checklist_items;
create policy checklist_items_all on public.checklist_items for all using (
  exists (
    select 1 from public.checklists c
    join public.tasks t on t.id = c.task_id
    where c.id = checklist_id
      and public.is_org_member(t.tenant_id)
      and public.session_meets_mfa(t.tenant_id)
  )
);

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

    begin
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
    exception when others then
      insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
      values (task_rec.tenant_id, actor, 'trigger', 'notify_task_assigned_error', 'task', task_rec.id,
              jsonb_build_object('error', SQLERRM));
    end;
  end if;

  return NEW;
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
            select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
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
        select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
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

    begin
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
    exception when others then
      insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
      values (NEW.organization_id, actor, 'trigger', 'notify_member_invited_error', 'organization', NEW.organization_id,
              jsonb_build_object('error', SQLERRM));
    end;
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
        select decrypted_secret into notify_secret from vault.decrypted_secrets where name = 'internal_notify_secret';
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

revoke execute on function public.notify_task_assigned() from anon, authenticated, public;
revoke execute on function public.notify_task_completed() from anon, authenticated, public;
revoke execute on function public.notify_comment_added() from anon, authenticated, public;
revoke execute on function public.notify_member_invited() from anon, authenticated, public;
revoke execute on function public.notify_project_created() from anon, authenticated, public;
