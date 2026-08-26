-- Cada tabla abajo tenía una política "_select" dedicada (member-level) y una
-- política "_write" FOR ALL (owner-level) cuyo alcance de SELECT quedaba
-- superpuesto/redundante con la primera (multiple_permissive_policies del
-- advisor de performance). Como "_select" ya es igual o más permisiva para
-- lectura que "_write", dividir "_write" en INSERT/UPDATE/DELETE explícitos
-- (sin SELECT) no reduce ningún acceso existente — solo elimina la doble
-- evaluación por fila.

-- board_columns
drop policy board_columns_write on public.board_columns;
create policy board_columns_insert on public.board_columns for insert
  with check (exists (select 1 from boards b where b.id = board_columns.board_id and is_org_member(b.tenant_id) and has_permission(b.id, 'board.manage')));
create policy board_columns_update on public.board_columns for update
  using (exists (select 1 from boards b where b.id = board_columns.board_id and is_org_member(b.tenant_id) and has_permission(b.id, 'board.manage')))
  with check (exists (select 1 from boards b where b.id = board_columns.board_id and is_org_member(b.tenant_id) and has_permission(b.id, 'board.manage')));
create policy board_columns_delete on public.board_columns for delete
  using (exists (select 1 from boards b where b.id = board_columns.board_id and is_org_member(b.tenant_id) and has_permission(b.id, 'board.manage')));

-- integrations
drop policy integrations_write on public.integrations;
create policy integrations_insert on public.integrations for insert with check (is_org_owner(tenant_id));
create policy integrations_update on public.integrations for update using (is_org_owner(tenant_id)) with check (is_org_owner(tenant_id));
create policy integrations_delete on public.integrations for delete using (is_org_owner(tenant_id));

-- metrics_snapshots
drop policy metrics_snapshots_write on public.metrics_snapshots;
create policy metrics_snapshots_insert on public.metrics_snapshots for insert
  with check (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_owner(b.tenant_id)));
create policy metrics_snapshots_update on public.metrics_snapshots for update
  using (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_owner(b.tenant_id)))
  with check (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_owner(b.tenant_id)));
create policy metrics_snapshots_delete on public.metrics_snapshots for delete
  using (exists (select 1 from boards b where b.id = metrics_snapshots.board_id and is_org_owner(b.tenant_id)));

-- role_assignments
drop policy role_assignments_write on public.role_assignments;
create policy role_assignments_insert on public.role_assignments for insert with check (is_org_owner(tenant_id));
create policy role_assignments_update on public.role_assignments for update using (is_org_owner(tenant_id)) with check (is_org_owner(tenant_id));
create policy role_assignments_delete on public.role_assignments for delete using (is_org_owner(tenant_id));

-- role_permissions
drop policy role_permissions_write on public.role_permissions;
create policy role_permissions_insert on public.role_permissions for insert
  with check (exists (select 1 from roles r where r.id = role_permissions.role_id and r.tenant_id is not null and is_org_owner(r.tenant_id)));
create policy role_permissions_update on public.role_permissions for update
  using (exists (select 1 from roles r where r.id = role_permissions.role_id and r.tenant_id is not null and is_org_owner(r.tenant_id)))
  with check (exists (select 1 from roles r where r.id = role_permissions.role_id and r.tenant_id is not null and is_org_owner(r.tenant_id)));
create policy role_permissions_delete on public.role_permissions for delete
  using (exists (select 1 from roles r where r.id = role_permissions.role_id and r.tenant_id is not null and is_org_owner(r.tenant_id)));

-- roles
drop policy roles_write on public.roles;
create policy roles_insert on public.roles for insert with check (tenant_id is not null and is_org_owner(tenant_id));
create policy roles_update on public.roles for update using (tenant_id is not null and is_org_owner(tenant_id)) with check (tenant_id is not null and is_org_owner(tenant_id));
create policy roles_delete on public.roles for delete using (tenant_id is not null and is_org_owner(tenant_id));

-- webhooks_outbound
drop policy webhooks_outbound_write on public.webhooks_outbound;
create policy webhooks_outbound_insert on public.webhooks_outbound for insert with check (is_org_owner(tenant_id));
create policy webhooks_outbound_update on public.webhooks_outbound for update using (is_org_owner(tenant_id)) with check (is_org_owner(tenant_id));
create policy webhooks_outbound_delete on public.webhooks_outbound for delete using (is_org_owner(tenant_id));
