-- CRITICAL fix found in a comprehensive platform audit: search_profile_by_email
-- is a SECURITY DEFINER function grantable to anon with zero internal
-- authorization check — any unauthenticated caller could POST to
-- /rest/v1/rpc/search_profile_by_email with an arbitrary email and learn
-- whether an account exists plus its full_name (PII/user-enumeration leak).
-- Its only real caller (inviteMemberByEmail in src/lib/supabase/members-repo.ts)
-- always runs from an authenticated session, so requiring auth.uid() is not
-- null matches the actual intended usage exactly — the caller doesn't need
-- to already be a member of any particular org (they're inviting into one),
-- just needs to be signed in at all.
create or replace function public.search_profile_by_email(p_email text)
 returns table(id uuid, email text, full_name text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p.id, p.email, p.full_name
  from profiles p
  where auth.uid() is not null
    and p.email = lower(trim(p_email))
  limit 1;
$function$;

revoke execute on function public.search_profile_by_email(text) from anon;
