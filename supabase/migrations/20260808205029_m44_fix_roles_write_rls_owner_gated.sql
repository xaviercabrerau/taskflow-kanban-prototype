-- Bug: roles_write / role_permissions_write were gated by is_org_member,
-- letting ANY member create/edit/delete custom roles and rewire permission
-- sets org-wide, not just the owner. Management operations must be
-- owner-gated (read-only stays member-gated), matching the pattern already
-- used for role_assignments/workspaces/boards this project.
drop policy if exists roles_write on roles;
create policy roles_write on roles
  for all
  using (tenant_id is not null and is_org_owner(tenant_id))
  with check (tenant_id is not null and is_org_owner(tenant_id));

drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions
  for all
  using (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and r.tenant_id is not null
        and is_org_owner(r.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and r.tenant_id is not null
        and is_org_owner(r.tenant_id)
    )
  );
