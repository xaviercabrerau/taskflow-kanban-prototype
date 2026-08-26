-- Aislamiento multi-tenant base (Sección 7.9). Nota: se usa is_org_member(tenant_id)
-- en vez de current_setting('app.current_tenant') porque Supabase corre sobre
-- PgBouncer en modo transacción: las variables de sesión SET no persisten de
-- forma confiable entre statements pooled. is_org_member() lee auth.uid()
-- directamente, que sí es estable por request bajo Supabase Auth.
-- El RBAC granular por permiso (task.create, board.manage, etc. de la Sección 1.4)
-- es la siguiente capa, no cubierta todavía por estas políticas base.

alter table organizations enable row level security;
create policy org_select on organizations for select using (public.is_org_member(id));
create policy org_insert on organizations for insert to authenticated with check (true);
create policy org_update on organizations for update using (
  exists (select 1 from organization_members m where m.organization_id = id and m.user_id = auth.uid() and m.org_role in ('owner','admin'))
);

alter table organization_members enable row level security;
create policy org_members_select on organization_members for select using (public.is_org_member(organization_id));
create policy org_members_write on organization_members for all using (
  exists (select 1 from organization_members m where m.organization_id = organization_members.organization_id and m.user_id = auth.uid() and m.org_role in ('owner','admin'))
);

alter table roles enable row level security;
create policy roles_select on roles for select using (tenant_id is null or public.is_org_member(tenant_id));
create policy roles_write on roles for all using (tenant_id is not null and public.is_org_member(tenant_id));

alter table permissions enable row level security;
create policy permissions_select on permissions for select to authenticated using (true);

alter table role_permissions enable row level security;
create policy role_permissions_select on role_permissions for select using (
  exists (select 1 from roles r where r.id = role_id and (r.tenant_id is null or public.is_org_member(r.tenant_id)))
);
create policy role_permissions_write on role_permissions for all using (
  exists (select 1 from roles r where r.id = role_id and r.tenant_id is not null and public.is_org_member(r.tenant_id))
);

alter table role_assignments enable row level security;
create policy role_assignments_all on role_assignments for all using (public.is_org_member(tenant_id));

alter table board_templates enable row level security;
create policy board_templates_select on board_templates for select using (tenant_id is null or public.is_org_member(tenant_id));
create policy board_templates_write on board_templates for all using (tenant_id is not null and public.is_org_member(tenant_id));

alter table workspaces enable row level security;
create policy workspaces_all on workspaces for all using (public.is_org_member(tenant_id));

alter table boards enable row level security;
create policy boards_all on boards for all using (public.is_org_member(tenant_id));

alter table board_columns enable row level security;
create policy board_columns_all on board_columns for all using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id))
);

alter table custom_field_definitions enable row level security;
create policy custom_fields_all on custom_field_definitions for all using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id))
);

alter table epics enable row level security;
create policy epics_all on epics for all using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id))
);

alter table sprints enable row level security;
create policy sprints_all on sprints for all using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id))
);

alter table tasks enable row level security;
create policy tasks_all on tasks for all using (public.is_org_member(tenant_id));

alter table task_assignees enable row level security;
create policy task_assignees_all on task_assignees for all using (
  exists (select 1 from tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

alter table tags enable row level security;
create policy tags_all on tags for all using (public.is_org_member(tenant_id));

alter table task_tags enable row level security;
create policy task_tags_all on task_tags for all using (
  exists (select 1 from tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

alter table task_links enable row level security;
create policy task_links_all on task_links for all using (
  exists (select 1 from tasks t where t.id = source_task_id and public.is_org_member(t.tenant_id))
);

alter table comments enable row level security;
create policy comments_all on comments for all using (
  exists (select 1 from tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

alter table attachments enable row level security;
create policy attachments_all on attachments for all using (
  exists (select 1 from tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

alter table activity_log enable row level security;
create policy activity_log_all on activity_log for all using (
  exists (select 1 from tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

-- audit_log: solo SELECT e INSERT. Sin políticas UPDATE/DELETE => denegado por
-- defecto para cualquier rol de aplicación (append-only real, no solo por convención).
alter table audit_log enable row level security;
create policy audit_log_select on audit_log for select using (public.is_org_member(tenant_id));
create policy audit_log_insert on audit_log for insert with check (public.is_org_member(tenant_id));

alter table notifications enable row level security;
create policy notifications_all on notifications for all using (user_id = auth.uid());

alter table notification_preferences enable row level security;
create policy notification_prefs_all on notification_preferences for all using (user_id = auth.uid());

alter table email_threads enable row level security;
create policy email_threads_all on email_threads for all using (
  exists (select 1 from tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

alter table automation_rules enable row level security;
create policy automation_rules_all on automation_rules for all using (public.is_org_member(tenant_id));

alter table automation_executions enable row level security;
create policy automation_executions_all on automation_executions for all using (
  exists (select 1 from automation_rules r where r.id = rule_id and public.is_org_member(r.tenant_id))
);

alter table integrations enable row level security;
create policy integrations_all on integrations for all using (public.is_org_member(tenant_id));

alter table webhooks_outbound enable row level security;
create policy webhooks_all on webhooks_outbound for all using (public.is_org_member(tenant_id));

alter table mcp_sessions enable row level security;
create policy mcp_sessions_all on mcp_sessions for all using (public.is_org_member(tenant_id));

alter table metrics_snapshots enable row level security;
create policy metrics_snapshots_all on metrics_snapshots for all using (
  exists (select 1 from boards b where b.id = board_id and public.is_org_member(b.tenant_id))
);
