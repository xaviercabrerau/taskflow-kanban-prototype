-- Correcciones de la revisión completa de rendimiento de base de datos
-- (get_advisors(type="performance"), 2026-09-04). Todas de solo agregar
-- índices o reescribir una política RLS existente sin cambiar su lógica —
-- ningún cambio de comportamiento, solo de plan de ejecución.

-- 1. Foreign keys sin índice de cobertura (confirmado por el advisor oficial
--    de Supabase). El más relevante es task_github_links.tenant_id, usado
--    por la política RLS is_org_member(tenant_id) en cada consulta de esa
--    tabla — sin índice, cada select hace un seq scan.
create index if not exists task_github_links_tenant_idx on public.task_github_links(tenant_id);
create index if not exists task_github_links_created_by_idx on public.task_github_links(created_by);
create index if not exists notifications_actor_id_idx on public.notifications(actor_id);
create index if not exists notification_preferences_org_id_idx on public.notification_preferences(organization_id);
create index if not exists public_share_links_created_by_idx on public.public_share_links(created_by);
create index if not exists recurring_task_templates_assignee_idx on public.recurring_task_templates(assignee_user_id);
create index if not exists recurring_task_templates_column_idx on public.recurring_task_templates(column_id);
create index if not exists recurring_task_templates_created_by_idx on public.recurring_task_templates(created_by);
create index if not exists saved_views_board_id_idx on public.saved_views(board_id);
create index if not exists template_installs_user_id_idx on public.template_installs(user_id);
create index if not exists email_threads_user_id_idx on public.email_threads(user_id);

-- 2. notifications: el listado principal (fetchNotifications) filtra por
--    user_id y ordena por created_at desc — el índice existente
--    (user_id, read_at) no cubre ese order by. A escala de piloto es
--    invisible, pero se degrada mal en cuanto una cuenta acumule miles de
--    notificaciones (hallazgo de la revisión de calidad de BD).
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);

-- 3. RLS Auth InitPlan: profiles_select reevaluaba auth.uid() por cada fila
--    en vez de una sola vez por consulta (advisor "auth_rls_initplan",
--    WARN) — se envuelve en (select auth.uid()) sin cambiar la lógica de
--    autorización.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    id = (select auth.uid())
    or exists (
      select 1
      from organization_members m1
      join organization_members m2 on m1.organization_id = m2.organization_id
      where m1.user_id = (select auth.uid()) and m2.user_id = profiles.id
    )
  );
