-- Same issue as activity_log.actor_id (previous migration): every other nullable
-- "who did this" FK to auth.users(id) was left at the default ON DELETE RESTRICT,
-- which blocks deleting a user the moment they've created a task, authored a
-- comment, uploaded a file, owned an org, etc. Switch them all to SET NULL so
-- the historical record survives account deletion instead of preventing it.
alter table tasks
  drop constraint tasks_created_by_fkey,
  add constraint tasks_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table comments
  drop constraint comments_author_id_fkey,
  add constraint comments_author_id_fkey
    foreign key (author_id) references auth.users(id) on delete set null;

alter table attachments
  drop constraint attachments_uploaded_by_fkey,
  add constraint attachments_uploaded_by_fkey
    foreign key (uploaded_by) references auth.users(id) on delete set null;

alter table audit_log
  drop constraint audit_log_actor_id_fkey,
  add constraint audit_log_actor_id_fkey
    foreign key (actor_id) references auth.users(id) on delete set null;

alter table organization_members
  drop constraint organization_members_invited_by_fkey,
  add constraint organization_members_invited_by_fkey
    foreign key (invited_by) references auth.users(id) on delete set null;

alter table role_assignments
  drop constraint role_assignments_granted_by_fkey,
  add constraint role_assignments_granted_by_fkey
    foreign key (granted_by) references auth.users(id) on delete set null;

alter table boards
  drop constraint boards_created_by_fkey,
  add constraint boards_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table automation_rules
  drop constraint automation_rules_created_by_fkey,
  add constraint automation_rules_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table board_templates
  drop constraint board_templates_published_by_fkey,
  add constraint board_templates_published_by_fkey
    foreign key (published_by) references auth.users(id) on delete set null;

-- organizations.owner_id backs is_org_owner(); if an owner account is deleted,
-- owner_id goes null and owner-gated RLS locks out that org until a new owner
-- is set — same tradeoff every other column here makes (allow deletion,
-- surviving rows lose the actor reference), left for the app to handle via its
-- existing member-management UI.
alter table organizations
  drop constraint organizations_owner_id_fkey,
  add constraint organizations_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete set null;
