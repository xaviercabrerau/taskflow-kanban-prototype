-- Gestión de miembros (invitar a otros usuarios ya registrados) sin repetir la
-- recursión de RLS de la migración anterior: en vez de que la política de
-- organization_members vuelva a consultar organization_members, se apoya en
-- una columna denormalizada `owner_id` en `organizations` (tabla distinta) más
-- una función security definer que solo toca `organizations`.
alter table organizations add column owner_id uuid references auth.users(id);
update organizations o set owner_id = m.user_id
  from organization_members m
  where m.organization_id = o.id and m.org_role = 'owner' and o.owner_id is null;

create function public.is_org_owner(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from organizations where id = org_id and owner_id = auth.uid());
$$;
revoke execute on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_owner(uuid) to authenticated;

create or replace function public.create_organization(org_name text, org_slug text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org organizations;
begin
  insert into organizations (name, slug, owner_id) values (org_name, org_slug, auth.uid()) returning * into new_org;
  insert into organization_members (organization_id, user_id, org_role)
    values (new_org.id, auth.uid(), 'owner');
  return new_org;
end;
$$;

-- El owner ahora puede ver y gestionar (agregar/quitar/cambiar rol) filas de
-- CUALQUIER miembro de su organización, además de su propia fila.
create policy org_members_select_owner on organization_members for select using (public.is_org_owner(organization_id));
create policy org_members_write_owner on organization_members for all using (public.is_org_owner(organization_id));

-- Búsqueda por email para invitar: se necesita resolver "email -> user_id" sin
-- Service Role Key. Se denormaliza el email en `profiles` (poblado por el
-- trigger de alta) y se permite lectura a cualquier autenticado — profiles no
-- tiene datos sensibles (nombre, avatar, estado, email de trabajo), trade-off
-- aceptable para un flujo de invitación tipo "coworkers".
alter table profiles add column email text;
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url', new.email);
  return new;
end;
$$;

drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated using (true);
