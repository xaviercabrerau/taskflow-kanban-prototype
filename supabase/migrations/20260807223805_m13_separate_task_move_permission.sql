-- Deuda técnica documentada en el turno anterior: separar "mover de columna"
-- (drag-and-drop) de "editar campos" como permisos independientes, en vez de
-- que task.update cubra ambos.
insert into permissions (key, description, category) values
  ('task.move', 'Mover tareas entre columnas (drag-and-drop)', 'task');

-- Los roles que ya tenían task.update conservan también task.move (mismo
-- nivel de confianza); Admin la recibe explícitamente porque su fila fue
-- poblada por un cross join que ya corrió antes de que este permiso existiera.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.is_system and r.name in ('Admin','Manager','Contribuyente') and p.key = 'task.move';

-- La política RLS de UPDATE deja pasar la fila si el usuario tiene
-- CUALQUIERA de los dos permisos; el trigger de abajo hace la distinción
-- fina campo por campo (igual que ya distingue el propio código cliente:
-- moveTaskRemote solo toca column_id/position, updateTaskFields solo toca
-- el resto).
drop policy tasks_update on tasks;
create policy tasks_update on tasks for update using (
  public.is_org_member(tenant_id)
  and (public.has_permission(board_id, 'task.update') or public.has_permission(board_id, 'task.move'))
);

create function public.check_task_move_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
$$;

create trigger trg_check_task_move
  before update on tasks
  for each row execute function public.check_task_move_permission();
