-- El grant original venía de PUBLIC (todo rol lo hereda), no solo de anon/authenticated.
-- Hay que revocar de PUBLIC explícitamente para que deje de ser invocable como RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
