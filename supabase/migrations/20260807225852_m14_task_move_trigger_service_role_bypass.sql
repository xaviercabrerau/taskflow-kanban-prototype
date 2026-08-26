-- El trigger check_task_move_permission (m13) bloqueaba cualquier UPDATE en
-- `tasks` sin un auth.uid() válido en el JWT — incluyendo llamadas hechas con
-- la service_role key (futuro motor de automatizaciones/backend jobs) o SQL
-- administrativo directo, ninguna de las cuales tiene sesión de usuario.
-- RLS ya no protege esos casos porque service_role/postgres tienen
-- BYPASSRLS, pero los triggers SÍ se ejecutan igual (bypassrls no los
-- suprime) — por eso hace falta esta excepción explícita aquí.
--
-- Es seguro bypassear el chequeo cuando no hay auth.uid(): para roles
-- normales (anon/authenticated) que llegan vía PostgREST, si el JWT no trae
-- `sub` la propia política RLS de tasks_update (que depende de
-- has_permission(), y esa depende de auth.uid()) ya habría rechazado la fila
-- antes de que el trigger se ejecute. El único camino real para llegar aquí
-- sin auth.uid() es un contexto que ya bypassea RLS.
create or replace function public.check_task_move_permission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.column_id is distinct from old.column_id then
    if not (public.has_permission(new.board_id, 'task.move') or public.has_permission(new.board_id, 'task.update')) then
      raise exception 'permission denied: se requiere el permiso task.move para cambiar de columna';
    end if;
  end if;
  if (new.title, new.description, new.priority, new.assignee_name, new.tag, new.due_date, new.start_date)
     is distinct from (old.title, old.description, old.priority, old.assignee_name, old.tag, old.due_date, old.start_date)
  then
    if not public.has_permission(new.board_id, 'task.update') then
      raise exception 'permission denied: se requiere el permiso task.update para editar estos campos';
    end if;
  end if;
  return new;
end;
$function$;
