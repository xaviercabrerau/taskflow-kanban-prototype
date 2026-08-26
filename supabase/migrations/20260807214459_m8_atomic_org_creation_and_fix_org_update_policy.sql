-- Bug real: el INSERT normal a `organizations` seguido de `.select()` (RETURNING)
-- vuelve a evaluar la política de SELECT (is_org_member(id)) sobre la fila
-- recién creada, y en ese instante todavía no existe la membresía → falla y
-- Postgres revierte el INSERT completo. Se resuelve con una función atómica
-- security definer que crea la organización y la membresía de owner en la
-- misma transacción, sin pasar por RLS en el paso intermedio.
create function public.create_organization(org_name text, org_slug text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org organizations;
begin
  insert into organizations (name, slug) values (org_name, org_slug) returning * into new_org;
  insert into organization_members (organization_id, user_id, org_role)
    values (new_org.id, auth.uid(), 'owner');
  return new_org;
end;
$$;
revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- Bug real encontrado al auditar pg_policies: comparaba m.organization_id = m.id
-- (columnas de la misma fila, siempre falso salvo casualidad) en vez de contra
-- organizations.id. Dejaba UPDATE en organizations inutilizable para cualquiera.
drop policy org_update on organizations;
create policy org_update on organizations for update using (
  exists (select 1 from organization_members m where m.organization_id = organizations.id and m.user_id = auth.uid() and m.org_role in ('owner','admin'))
);
