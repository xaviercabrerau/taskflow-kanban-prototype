-- Bug de seguridad real: la política original (migración m1) permitía a
-- CUALQUIER miembro de la organización insertar/editar/borrar filas en
-- role_assignments (using is_org_member, sin distinguir owner). Combinado con
-- el sistema de permisos de esta migración, un Contribuyente podía otorgarse
-- a sí mismo el rol Admin. Se restringe la escritura al owner.
drop policy role_assignments_all on role_assignments;
create policy role_assignments_select on role_assignments for select using (public.is_org_member(tenant_id));
create policy role_assignments_write on role_assignments for all using (public.is_org_owner(tenant_id));
