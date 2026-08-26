alter table board_templates
  add column description text,
  add column is_public boolean not null default false,
  add column published_by uuid references auth.users(id),
  add column install_count integer not null default 0;

drop policy if exists board_templates_select on board_templates;
create policy board_templates_select on board_templates
  for select
  using (tenant_id is null or is_org_member(tenant_id) or is_public = true);
