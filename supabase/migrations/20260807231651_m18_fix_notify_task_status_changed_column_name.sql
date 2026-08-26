-- Bug: board_columns no tiene columna "title", es "label" (ver seed en
-- bootstrap.ts). Detectado al probar el trigger de m17 con SQL simulado.
create or replace function public.notify_task_status_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  new_col_label text;
begin
  if new.column_id is distinct from old.column_id
     and new.created_by is not null
     and new.created_by is distinct from actor
  then
    select label into new_col_label from public.board_columns where id = new.column_id;
    insert into public.notifications (tenant_id, user_id, type, title, body, related_task_id)
    values (
      new.tenant_id,
      new.created_by,
      'status_changed',
      'Tu tarea cambió de estado',
      format('"%s" se movió a "%s"', new.title, coalesce(new_col_label, '—')),
      new.id
    );
  end if;
  return new;
end;
$function$;
