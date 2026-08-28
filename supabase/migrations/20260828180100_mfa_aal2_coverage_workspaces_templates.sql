-- Extends the MFA/AAL2 defense-in-depth (mfa_aal2_rls_defense_in_depth,
-- extend_mfa_aal2_coverage) to workspaces_select and board_templates_select,
-- which were missed by both prior passes. Public templates (is_public = true)
-- are intentionally left ungated by MFA since they carry no tenant-confidential
-- data — only private, tenant-owned rows require AAL2 when the org mandates MFA.
-- Applied directly against the remote project via the Supabase MCP tool; this
-- file is the versioned record so `supabase db push` doesn't diverge.

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select
  using (is_org_member(tenant_id) and session_meets_mfa(tenant_id));

drop policy if exists board_templates_select on public.board_templates;
create policy board_templates_select on public.board_templates
  for select
  using (
    (tenant_id is null)
    or (is_org_member(tenant_id) and session_meets_mfa(tenant_id))
    or (is_public = true)
  );
