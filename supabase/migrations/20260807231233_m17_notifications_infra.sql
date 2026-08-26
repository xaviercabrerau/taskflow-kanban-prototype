-- Fase 3 (alcance in-app, ver decisión de sesión): infraestructura real de
-- notificaciones sobre las tablas ya creadas en m1 (notifications).

-- 1) La política previa (notifications_all, cmd ALL) permitía que un usuario
--    insertara notificaciones arbitrarias para sí mismo. Las notificaciones
--    reales las genera el sistema (triggers SECURITY DEFINER, que bypassean
--    RLS por ownership); el usuario solo necesita leer las suyas y marcarlas
--    como leídas.
drop policy if exists notifications_all on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid());

-- 2) Notifica al creador de la tarea cuando OTRO usuario mueve la tarea a
-- otra columna (evento 'status_changed'). No notificamos por "assigned"
-- todavía porque tasks.assignee_name es texto libre, no un user_id real
-- (limitación documentada del prototipo) — solo eventos con un user_id
-- verdadero disparan notificación.
create or replace function public.notify_task_status_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  new_col_title text;
begin
  if new.column_id is distinct from old.column_id
     and new.created_by is not null
     and new.created_by is distinct from actor
  then
    select title into new_col_title from public.board_columns where id = new.column_id;
    insert into public.notifications (tenant_id, user_id, type, title, body, related_task_id)
    values (
      new.tenant_id,
      new.created_by,
      'status_changed',
      'Tu tarea cambió de estado',
      format('"%s" se movió a "%s"', new.title, coalesce(new_col_title, '—')),
      new.id
    );
  end if;
  return new;
end;
$function$;

revoke execute on function public.notify_task_status_changed() from anon, authenticated, public;

drop trigger if exists trg_notify_task_status_changed on public.tasks;
create trigger trg_notify_task_status_changed
  after update on public.tasks
  for each row
  execute function public.notify_task_status_changed();

-- 3) Vencimiento próximo (24h): job periódico en vez de trigger, porque el
-- evento lo dispara el paso del tiempo, no una escritura. Se marca
-- due_soon_notified_at para no duplicar el aviso.
alter table public.tasks add column if not exists due_soon_notified_at timestamptz;

create or replace function public.check_due_soon_tasks()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.notifications (tenant_id, user_id, type, title, body, related_task_id)
  select t.tenant_id, t.created_by, 'due_soon', 'Tarea próxima a vencer',
         format('"%s" vence el %s', t.title, to_char(t.due_date, 'DD Mon YYYY')),
         t.id
  from public.tasks t
  where t.due_date is not null
    and t.due_date between now() and now() + interval '24 hours'
    and t.due_soon_notified_at is null
    and t.created_by is not null;

  update public.tasks
  set due_soon_notified_at = now()
  where due_date is not null
    and due_date between now() and now() + interval '24 hours'
    and due_soon_notified_at is null
    and created_by is not null;
end;
$function$;

revoke execute on function public.check_due_soon_tasks() from anon, authenticated, public;

create extension if not exists pg_cron;
select cron.schedule(
  'taskflow_check_due_soon_tasks',
  '0 * * * *',
  $$select public.check_due_soon_tasks();$$
) where not exists (select 1 from cron.job where jobname = 'taskflow_check_due_soon_tasks');
