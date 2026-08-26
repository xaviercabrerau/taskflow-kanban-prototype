-- organization_members tenía 4 políticas superpuestas causando el
-- "multiple_permissive_policies" del advisor (SELECT: 3 políticas, DELETE:
-- 2 políticas). Se dejó fuera intencionalmente en una pasada anterior por
-- ser la tabla que gestiona membresía/expulsión. Consolidamos en 4
-- políticas (una por comando, sin solapamiento), preservando el acceso
-- IDÉNTICO:
--   SELECT: antes (own OR owner OR owner[vía ALL]) -> ahora (own OR owner)
--   DELETE: antes (own OR owner[vía ALL])           -> ahora (own OR owner)
--   INSERT: antes (owner[vía ALL])                  -> ahora (owner)
--   UPDATE: antes (owner[vía ALL])                   -> ahora (owner)

drop policy org_members_select_own on public.organization_members;
drop policy org_members_select_owner on public.organization_members;
drop policy org_members_self_leave on public.organization_members;
drop policy org_members_write_owner on public.organization_members;

create policy org_members_select on public.organization_members
  for select
  using (user_id = (select auth.uid()) or is_org_owner(organization_id));

create policy org_members_delete on public.organization_members
  for delete
  using (user_id = (select auth.uid()) or is_org_owner(organization_id));

create policy org_members_insert on public.organization_members
  for insert
  with check (is_org_owner(organization_id));

create policy org_members_update on public.organization_members
  for update
  using (is_org_owner(organization_id))
  with check (is_org_owner(organization_id));
