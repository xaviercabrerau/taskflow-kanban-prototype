-- Elimina la política ALL sin WITH CHECK propio que permitía a cualquier
-- usuario autenticado hacer UPDATE/INSERT sobre su propia fila de
-- organization_members sin validar org_role ni organization_id (Postgres
-- reutilizaba el mismo USING como WITH CHECK, permitiendo auto-promoción a
-- owner o auto-unión como owner a una organización ajena).
--
-- members-repo.ts confirma que ningún flujo legítimo depende de que un
-- miembro no-owner haga INSERT/UPDATE directo sobre su propia fila:
--   - La creación de membresía inicial pasa por la RPC SECURITY DEFINER
--     create_organization (ver bootstrap.ts / m8), que bypasea RLS.
--   - inviteMemberByEmail inserta la fila del NUEVO miembro pero es
--     ejecutado por el owner (org_members_write_owner vía is_org_owner),
--     nunca por el propio usuario invitado.
-- El único caso self-service legítimo remanente es que un miembro pueda
-- salir de su organización (DELETE de su propia fila), así que se
-- reemplaza la policy amplia por una mínima de solo-DELETE.
drop policy if exists org_members_write_own on public.organization_members;

create policy org_members_self_leave
  on public.organization_members
  for delete
  using (user_id = auth.uid());
