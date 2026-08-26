-- Bug real: Postgres detecta "infinite recursion detected in policy for
-- relation organization_members" (42P17) cuando la política de esa tabla
-- llama a is_org_member(), que a su vez consulta organization_members otra
-- vez. Esto ocurre PESE a que is_org_member es security definer (bypassrls) —
-- confirmado en producción: is_org_member() funciona bien invocada sola vía
-- RPC, pero falla en cuanto queda anidada dentro de una política que protege
-- la MISMA tabla que la función consulta. El guard de recursión de Postgres es
-- estático y no distingue el bypass de rol interno en ese caso específico.
--
-- Fix: las políticas propias de organization_members no pueden referenciar la
-- tabla otra vez, ni directa ni indirectamente vía función. Se simplifica a
-- "cada usuario ve/gestiona su propia fila de membresía". La gestión de
-- miembros por parte de owner/admin (ver o invitar a OTROS usuarios) queda
-- pendiente para cuando exista una tabla de ownership separada (o claims JWT)
-- que no dependa de la propia organization_members para evitar este problema.
drop policy org_members_select on organization_members;
drop policy org_members_write on organization_members;

create policy org_members_select_own on organization_members for select using (user_id = auth.uid());
create policy org_members_write_own on organization_members for all using (user_id = auth.uid());
