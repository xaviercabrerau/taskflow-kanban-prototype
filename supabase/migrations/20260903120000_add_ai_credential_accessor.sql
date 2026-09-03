-- Fase 5: IA (crear tareas por lenguaje natural + resumen de comentarios).
-- Accesor server-only para la credencial de IA de una organización — mismo
-- patrón que get_google_refresh_token en
-- 20260829001000_google_integration_foundation.sql: revocado de
-- anon/authenticated, solo invocable con la service-role key desde código
-- server (src/lib/ai/client.ts). Prioriza 'openai' sobre 'anthropic' si
-- ambos están configurados y activos; el llamador decide qué API usar según
-- el provider devuelto.
create or replace function public.get_ai_credential(p_tenant_id uuid)
returns table(provider text, api_key text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret_id uuid;
  v_provider text;
begin
  select credentials_enc::uuid, i.provider into v_secret_id, v_provider
  from integrations i
  where tenant_id = p_tenant_id
    and i.provider in ('openai', 'anthropic')
    and is_active = true
    and credentials_enc is not null
  order by (i.provider = 'openai') desc
  limit 1;

  if v_secret_id is null then
    return;
  end if;

  return query
    select v_provider, decrypted_secret from vault.decrypted_secrets where id = v_secret_id;
end;
$function$;

revoke all on function public.get_ai_credential(uuid) from public, anon, authenticated;
