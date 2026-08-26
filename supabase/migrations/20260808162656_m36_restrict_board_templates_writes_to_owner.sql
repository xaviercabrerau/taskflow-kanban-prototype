drop policy if exists board_templates_write on public.board_templates;

create policy board_templates_insert on public.board_templates
  for insert
  with check (tenant_id is not null and is_org_owner(tenant_id));

create policy board_templates_update on public.board_templates
  for update
  using (tenant_id is not null and is_org_owner(tenant_id))
  with check (tenant_id is not null and is_org_owner(tenant_id));

create policy board_templates_delete on public.board_templates
  for delete
  using (tenant_id is not null and is_org_owner(tenant_id));
