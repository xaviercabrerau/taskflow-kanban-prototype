-- Sección 1.4 del plan: roles de sistema + catálogo de permisos.
insert into roles (tenant_id, name, is_system) values
  (null, 'Admin', true),
  (null, 'Manager', true),
  (null, 'Contribuyente', true),
  (null, 'Solo Lectura', true);

insert into permissions (key, description, category) values
  ('task.create', 'Crear tareas', 'task'),
  ('task.update', 'Editar y mover tareas', 'task'),
  ('task.delete', 'Eliminar tareas', 'task'),
  ('board.manage', 'Gestionar columnas y configuración del board', 'board'),
  ('member.invite', 'Invitar miembros a la organización', 'admin');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.name = 'Admin' and r.is_system;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.name = 'Manager' and r.is_system and p.key in ('task.create','task.update','task.delete','board.manage','member.invite');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.name = 'Contribuyente' and r.is_system and p.key in ('task.create','task.update');
-- 'Solo Lectura' no recibe ningún permiso de escritura a propósito.

-- has_permission: ¿auth.uid() tiene el permiso `perm_key` sobre el board `bid`?
-- El owner de la organización siempre pasa (superadmin implícito, igual que
-- is_org_owner). Para el resto, se resuelve vía role_assignments a nivel
-- board o workspace. security definer + bypassrls: consulta boards/roles/
-- role_assignments/role_permissions/permissions (todas distintas de la tabla
-- que protege la política que la invoque), sin el riesgo de recursión de la
-- migración anterior.
create function public.has_permission(bid uuid, perm_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from boards b
      join organizations o on o.id = b.tenant_id
      where b.id = bid and o.owner_id = auth.uid()
    )
    or exists (
      select 1
      from role_assignments ra
      join role_permissions rp on rp.role_id = ra.role_id
      join permissions p on p.id = rp.permission_id
      join boards b on b.id = bid
      where ra.user_id = auth.uid()
        and p.key = perm_key
        and (
          (ra.scope_type = 'board' and ra.scope_id = bid)
          or (ra.scope_type = 'workspace' and ra.scope_id = b.workspace_id)
        )
    );
$$;
revoke execute on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- my_permissions: el set de permission keys que el usuario actual tiene sobre
-- un board, para que el frontend habilite/oculte acciones sin adivinar.
create function public.my_permissions(bid uuid)
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select p.key from permissions p where public.has_permission(bid, p.key);
$$;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;

-- Escrituras en tasks ahora exigen el permiso granular correspondiente,
-- además del aislamiento por tenant ya existente.
drop policy tasks_all on tasks;
create policy tasks_select on tasks for select using (public.is_org_member(tenant_id));
create policy tasks_insert on tasks for insert with check (public.is_org_member(tenant_id) and public.has_permission(board_id, 'task.create'));
create policy tasks_update on tasks for update using (public.is_org_member(tenant_id) and public.has_permission(board_id, 'task.update'));
create policy tasks_delete on tasks for delete using (public.is_org_member(tenant_id) and public.has_permission(board_id, 'task.delete'));

drop policy board_columns_all on board_columns;
create policy board_columns_select on board_columns for select using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id))
);
create policy board_columns_write on board_columns for all using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id) and public.has_permission(b.id, 'board.manage'))
);

-- Backfill: asigna 'Admin' al owner y 'Contribuyente' al resto de miembros
-- actuales, a nivel de cada board existente en su organización.
insert into role_assignments (tenant_id, user_id, role_id, scope_type, scope_id, granted_by)
select b.tenant_id, o.owner_id, r.id, 'board', b.id, o.owner_id
from boards b
join organizations o on o.id = b.tenant_id
join roles r on r.name = 'Admin' and r.is_system
where o.owner_id is not null
on conflict (user_id, scope_type, scope_id) do nothing;

insert into role_assignments (tenant_id, user_id, role_id, scope_type, scope_id, granted_by)
select b.tenant_id, m.user_id, r.id, 'board', b.id, o.owner_id
from boards b
join organizations o on o.id = b.tenant_id
join organization_members m on m.organization_id = o.id and m.user_id <> o.owner_id
join roles r on r.name = 'Contribuyente' and r.is_system
on conflict (user_id, scope_type, scope_id) do nothing;
