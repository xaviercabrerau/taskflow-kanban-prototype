-- LOW #1: webhooks_inbound.created_by was missed in the earlier actor-FK
-- ON DELETE SET NULL cleanup, and also referenced profiles(id) instead of
-- auth.users(id) like every other actor column — normalize both.
alter table webhooks_inbound
  drop constraint webhooks_inbound_created_by_fkey,
  add constraint webhooks_inbound_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- LOW #2: role_assignments.scope_id is a polymorphic reference (board or
-- workspace, chosen by scope_type) with no FK — validate on write so it
-- can't be inserted/updated pointing at a nonexistent board/workspace.
-- (Existing rows are not rechecked; this only guards future writes.)
create or replace function public.validate_role_assignment_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.scope_type = 'board' then
    if not exists (select 1 from boards where id = new.scope_id) then
      raise exception 'scope_id % no es un board válido', new.scope_id;
    end if;
  elsif new.scope_type = 'workspace' then
    if not exists (select 1 from workspaces where id = new.scope_id) then
      raise exception 'scope_id % no es un workspace válido', new.scope_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger role_assignments_validate_scope
  before insert or update on role_assignments
  for each row execute function public.validate_role_assignment_scope();

-- LOW #3: automation webhook actions only checked the URL scheme (https),
-- not whether it points at a private/internal address — add a basic
-- host-based guard (literal private/loopback/link-local ranges; this does
-- not defend against DNS rebinding, which pg_net's own resolution makes
-- impractical to intercept here, but it closes the obvious cases).
create or replace function public.is_safe_webhook_url(url text)
returns boolean
language plpgsql
immutable
as $$
declare
  host text;
begin
  if url is null or url !~* '^https://' then
    return false;
  end if;
  host := lower(substring(url from '^https://([^/:]+)'));
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

create or replace function public.execute_automation_rules()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  event_type text;
  rule_rec record;
  action jsonb;
begin
  if coalesce(current_setting('automation.running', true), 'false') = 'true' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    event_type := 'task_created';
  elsif TG_OP = 'UPDATE' and NEW.column_id is distinct from OLD.column_id then
    event_type := 'status_changed';
  else
    return new;
  end if;

  perform set_config('automation.running', 'true', true);

  for rule_rec in
    select ar.*
    from automation_rules ar
    join boards b on b.workspace_id = ar.workspace_id
    where b.id = NEW.board_id
      and ar.tenant_id = NEW.tenant_id
      and ar.is_active
      and ar.trigger->>'type' = event_type
      and (
        event_type <> 'status_changed'
        or ar.trigger->>'to_column_id' is null
        or (ar.trigger->>'to_column_id')::uuid = NEW.column_id
      )
  loop
    if exists (select 1 from automation_executions ae where ae.rule_id = rule_rec.id and ae.task_id = NEW.id) then
      continue;
    end if;

    if not automation_conditions_match(rule_rec.conditions, NEW.priority, NEW.tag, NEW.assignee_name, NEW.title) then
      continue;
    end if;

    begin
      for action in select jsonb_array_elements(coalesce(rule_rec.actions, '[]'::jsonb))
      loop
        if action->>'type' = 'move_to_column' then
          update tasks set column_id = (action->>'column_id')::uuid where id = NEW.id;
        elsif action->>'type' = 'set_field' then
          if action->>'field' not in ('priority', 'tag', 'assignee_name') then
            raise exception 'campo no permitido: %', action->>'field';
          end if;
          execute format('update tasks set %I = $1 where id = $2', action->>'field')
            using (action->>'value'), NEW.id;
        elsif action->>'type' = 'add_comment' then
          insert into comments(task_id, author_id, body, source)
            values (NEW.id, null, action->>'body', 'automation');
        elsif action->>'type' = 'webhook' then
          if not is_safe_webhook_url(action->>'url') then
            raise exception 'la url del webhook no es válida (debe ser https y no apuntar a una red privada)';
          end if;
          perform net.http_post(
            url := action->>'url',
            body := jsonb_build_object(
              'event', event_type,
              'rule_id', rule_rec.id,
              'rule_name', rule_rec.name,
              'task_id', NEW.id,
              'task_title', NEW.title,
              'occurred_at', now()
            ),
            headers := jsonb_build_object('Content-Type', 'application/json')
          );
        end if;
      end loop;

      insert into automation_executions(rule_id, task_id, status) values (rule_rec.id, NEW.id, 'success');
    exception when others then
      insert into automation_executions(rule_id, task_id, status, error_message)
        values (rule_rec.id, NEW.id, 'error', SQLERRM);
    end;
  end loop;

  return new;
end;
$function$;

create or replace function public.execute_due_date_automations()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rule_rec record;
  task_rec record;
  action jsonb;
begin
  perform set_config('automation.running', 'true', true);

  for rule_rec in
    select ar.*
    from automation_rules ar
    where ar.is_active
      and ar.trigger->>'type' = 'due_date_approaching'
  loop
    for task_rec in
      select tk.*
      from tasks tk
      join boards bd on bd.id = tk.board_id
      where bd.workspace_id = rule_rec.workspace_id
        and tk.due_date is not null
        and tk.due_date <= now() + ((rule_rec.trigger->>'days_before')::int || ' days')::interval
        and tk.due_date > now()
        and not exists (
          select 1 from automation_executions ae where ae.rule_id = rule_rec.id and ae.task_id = tk.id
        )
        and automation_conditions_match(rule_rec.conditions, tk.priority, tk.tag, tk.assignee_name, tk.title)
    loop
      begin
        for action in select jsonb_array_elements(coalesce(rule_rec.actions, '[]'::jsonb))
        loop
          if action->>'type' = 'move_to_column' then
            update tasks set column_id = (action->>'column_id')::uuid where id = task_rec.id;
          elsif action->>'type' = 'set_field' then
            if action->>'field' not in ('priority', 'tag', 'assignee_name') then
              raise exception 'campo no permitido: %', action->>'field';
            end if;
            execute format('update tasks set %I = $1 where id = $2', action->>'field')
              using (action->>'value'), task_rec.id;
          elsif action->>'type' = 'add_comment' then
            insert into comments(task_id, author_id, body, source)
              values (task_rec.id, null, action->>'body', 'automation');
          elsif action->>'type' = 'webhook' then
            if not is_safe_webhook_url(action->>'url') then
              raise exception 'la url del webhook no es válida (debe ser https y no apuntar a una red privada)';
            end if;
            perform net.http_post(
              url := action->>'url',
              body := jsonb_build_object(
                'event', 'due_date_approaching',
                'rule_id', rule_rec.id,
                'rule_name', rule_rec.name,
                'task_id', task_rec.id,
                'task_title', task_rec.title,
                'occurred_at', now()
              ),
              headers := jsonb_build_object('Content-Type', 'application/json')
            );
          end if;
        end loop;

        insert into automation_executions(rule_id, task_id, status) values (rule_rec.id, task_rec.id, 'success');
      exception when others then
        insert into automation_executions(rule_id, task_id, status, error_message)
          values (rule_rec.id, task_rec.id, 'error', SQLERRM);
      end;
    end loop;
  end loop;
end;
$function$;

-- LOW #4: increment_template_install_count had no anti-abuse guard — any
-- authenticated user could call it repeatedly to inflate a template's
-- install_count. Track installs per (template_id, user_id) and only
-- increment on a caller's first install of a given template.
create table if not exists template_installs (
  template_id uuid not null references board_templates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installed_at timestamptz not null default now(),
  primary key (template_id, user_id)
);
alter table template_installs enable row level security;
-- No policies: only ever written via the SECURITY DEFINER function below.

create or replace function public.increment_template_install_count(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;

  insert into template_installs (template_id, user_id)
  values (p_template_id, auth.uid())
  on conflict (template_id, user_id) do nothing;

  if found then
    update board_templates
    set install_count = install_count + 1
    where id = p_template_id and is_public = true;
  end if;
end;
$function$;
