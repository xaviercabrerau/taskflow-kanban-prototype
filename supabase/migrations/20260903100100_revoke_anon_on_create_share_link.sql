-- create_share_link asume auth.uid() (lanza excepción si es null) y solo debe
-- ser invocable desde el cliente autenticado — igual que create_mcp_session,
-- revocado de anon en 20260810021943_tighten_security_definer_function_grants.sql.
-- Supabase otorga EXECUTE a anon por defecto en funciones nuevas del schema
-- public; sin este revoke explícito, cualquier visitante sin sesión podía
-- invocar la RPC (fallaría dentro por auth.uid() is null, pero no debería
-- ni siquiera ser alcanzable). resolve_share_link y add_share_link_comment
-- SÍ deben mantener su grant a anon: son el flujo público por token.
revoke execute on function public.create_share_link(uuid, uuid, text, text, timestamptz, text) from anon;
