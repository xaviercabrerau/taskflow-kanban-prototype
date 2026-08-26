-- The MFA/AAL2 defense-in-depth migration wrapped tasks/boards/board_columns/
-- comments/attachments with session_meets_mfa(), but epics, sprints, tags,
-- task_assignees, task_links, task_tags, checklists/checklist_items (added
-- after that migration and never revisited), activity_log, automation_rules,
-- and integrations were left out — an org with mfa_required=true still let a
-- non-AAL2 session read/write these. Extend the same guard to all of them.

alter policy epics_all on public.epics
  using (exists (
    select 1 from boards b
    where b.id = epics.board_id and is_org_member(b.tenant_id) and session_meets_mfa(b.tenant_id)
  ));

alter policy sprints_all on public.sprints
  using (exists (
    select 1 from boards b
    where b.id = sprints.board_id and is_org_member(b.tenant_id) and session_meets_mfa(b.tenant_id)
  ));

alter policy custom_fields_all on public.custom_field_definitions
  using (exists (
    select 1 from boards b
    where b.id = custom_field_definitions.board_id and is_org_member(b.tenant_id) and session_meets_mfa(b.tenant_id)
  ));

alter policy tags_all on public.tags
  using (is_org_member(tenant_id) and session_meets_mfa(tenant_id));

alter policy task_assignees_all on public.task_assignees
  using (exists (
    select 1 from tasks t
    where t.id = task_assignees.task_id and is_org_member(t.tenant_id) and session_meets_mfa(t.tenant_id)
  ));

alter policy task_links_all on public.task_links
  using (exists (
    select 1 from tasks t
    where t.id = task_links.source_task_id and is_org_member(t.tenant_id) and session_meets_mfa(t.tenant_id)
  ));

alter policy task_tags_all on public.task_tags
  using (exists (
    select 1 from tasks t
    where t.id = task_tags.task_id and is_org_member(t.tenant_id) and session_meets_mfa(t.tenant_id)
  ));

alter policy checklists_all on public.checklists
  using (exists (
    select 1 from tasks t
    where t.id = checklists.task_id and is_org_member(t.tenant_id) and session_meets_mfa(t.tenant_id)
  ));

alter policy checklist_items_all on public.checklist_items
  using (exists (
    select 1 from checklists c join tasks t on t.id = c.task_id
    where c.id = checklist_items.checklist_id and is_org_member(t.tenant_id) and session_meets_mfa(t.tenant_id)
  ));

alter policy activity_log_select on public.activity_log
  using (exists (
    select 1 from tasks t
    where t.id = activity_log.task_id and is_org_member(t.tenant_id) and session_meets_mfa(t.tenant_id)
  ));

alter policy automation_rules_select on public.automation_rules
  using (is_org_member(tenant_id) and session_meets_mfa(tenant_id));

alter policy integrations_select on public.integrations
  using (is_org_member(tenant_id) and session_meets_mfa(tenant_id));
