drop policy if exists automation_rules_all on public.automation_rules;

create policy automation_rules_select on public.automation_rules
  for select
  using (is_org_member(tenant_id));

create policy automation_rules_write on public.automation_rules
  for insert
  with check (is_org_owner(tenant_id));

create policy automation_rules_update on public.automation_rules
  for update
  using (is_org_owner(tenant_id));

create policy automation_rules_delete on public.automation_rules
  for delete
  using (is_org_owner(tenant_id));
