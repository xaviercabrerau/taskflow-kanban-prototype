
drop policy if exists mcp_sessions_all on mcp_sessions;
drop policy if exists mcp_sessions_select on mcp_sessions;
create policy mcp_sessions_own on mcp_sessions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists webhooks_all on webhooks_outbound;
create policy webhooks_outbound_write on webhooks_outbound
  for all
  using (is_org_owner(tenant_id))
  with check (is_org_owner(tenant_id));
create policy webhooks_outbound_select on webhooks_outbound
  for select
  using (is_org_owner(tenant_id));
