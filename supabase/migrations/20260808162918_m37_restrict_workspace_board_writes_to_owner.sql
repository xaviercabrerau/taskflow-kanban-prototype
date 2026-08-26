drop policy if exists workspaces_all on public.workspaces;
create policy workspaces_select on public.workspaces for select using (is_org_member(tenant_id));
create policy workspaces_insert on public.workspaces for insert with check (is_org_owner(tenant_id));
create policy workspaces_update on public.workspaces for update using (is_org_owner(tenant_id)) with check (is_org_owner(tenant_id));
create policy workspaces_delete on public.workspaces for delete using (is_org_owner(tenant_id));

drop policy if exists boards_all on public.boards;
create policy boards_select on public.boards for select using (is_org_member(tenant_id));
create policy boards_insert on public.boards for insert with check (is_org_owner(tenant_id));
create policy boards_update on public.boards for update using (is_org_owner(tenant_id)) with check (is_org_owner(tenant_id));
create policy boards_delete on public.boards for delete using (is_org_owner(tenant_id));
