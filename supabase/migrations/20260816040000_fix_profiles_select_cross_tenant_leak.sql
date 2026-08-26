-- profiles_select was widened to `using (true)` in m10 to support "invite by
-- email" lookups, but that lets any authenticated user read full_name/email/
-- avatar_url/status/last_login_at for every user in the project, not just
-- their own org — a cross-tenant PII leak. Restore the shared-org scoping
-- from m5, and give the invite flow a narrow SECURITY DEFINER lookup instead
-- of broad SELECT access.
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or exists (
    select 1 from organization_members m1
    join organization_members m2 on m1.organization_id = m2.organization_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);

-- Exact-match lookup only (no wildcard/listing) so inviteMemberByEmail can
-- find a not-yet-org-member user by email without needing broad profiles
-- SELECT access.
create or replace function public.search_profile_by_email(p_email text)
returns table (id uuid, email text, full_name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.email, p.full_name
  from profiles p
  where p.email = lower(trim(p_email))
  limit 1;
$$;
revoke execute on function public.search_profile_by_email(text) from anon;
grant execute on function public.search_profile_by_email(text) to authenticated;
