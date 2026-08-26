-- Cierra la limitación documentada de la Fase 2: los miembros no-owner no
-- podían ver la lista completa de la organización porque la política SELECT
-- de organization_members quedó restringida a `user_id = auth.uid()` (m9,
-- para evitar la recursión 42P17 de RLS: una política de esa tabla no puede
-- consultarla de nuevo, ni siquiera a través de una función SECURITY
-- DEFINER — Postgres detecta la auto-referencia al mismo OID en evaluación).
--
-- La política de la tabla organization_members NO cambia (sigue siendo
-- user_id = auth.uid()). En vez de ampliarla, se expone un RPC dedicado que
-- hace su propia consulta de nivel superior (no anidada dentro de la
-- política de la tabla), así que no dispara la recursión — el mismo patrón
-- ya usado por has_permission()/my_permissions().
create or replace function public.list_org_members(org_id uuid)
returns table(
  membership_id uuid,
  member_user_id uuid,
  org_role text,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_org_member(org_id) then
    raise exception 'permission denied: no eres miembro de esta organización';
  end if;

  return query
    select m.id, m.user_id, m.org_role, p.email, p.full_name
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    where m.organization_id = org_id;
end;
$function$;

revoke execute on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;
