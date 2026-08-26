-- Bug de la migración 1: profiles quedó sin RLS. Corrige exposición total de datos personales.
alter table profiles enable row level security;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or exists (
    select 1 from organization_members m1
    join organization_members m2 on m1.organization_id = m2.organization_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);
create policy profiles_update_own on profiles for update using (id = auth.uid());

-- handle_new_user solo debe ejecutarse vía el trigger de auth.users, no como RPC pública.
revoke execute on function public.handle_new_user() from anon, authenticated;

-- is_org_member sí necesita ser invocable por authenticated (se usa dentro de policies
-- evaluadas para ese rol), pero no por anon (usuarios no autenticados no tienen org).
revoke execute on function public.is_org_member(uuid) from anon;
