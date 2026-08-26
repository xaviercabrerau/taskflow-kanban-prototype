-- Envuelve auth.uid() en (select auth.uid()) para que el planner lo evalúe
-- una sola vez por statement en vez de una vez por fila (auth_rls_initplan).
alter policy mcp_sessions_own on public.mcp_sessions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy notification_prefs_all on public.notification_preferences
  using (user_id = (select auth.uid()));

alter policy notifications_select_own on public.notifications
  using (user_id = (select auth.uid()));

alter policy notifications_update_own on public.notifications
  using (user_id = (select auth.uid()));

alter policy org_members_select_own on public.organization_members
  using (user_id = (select auth.uid()));

alter policy org_members_self_leave on public.organization_members
  using (user_id = (select auth.uid()));

alter policy org_update on public.organizations
  using (exists (
    select 1 from organization_members m
    where m.organization_id = organizations.id
      and m.user_id = (select auth.uid())
      and m.org_role = any (array['owner'::text, 'admin'::text])
  ));

alter policy profiles_update_own on public.profiles
  using (id = (select auth.uid()));
