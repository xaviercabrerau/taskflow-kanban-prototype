-- Foundation for real Google Workspace integrations (Calendar sync, Drive
-- file attachments) requested to sit alongside the existing
-- credential-storage-only IntegrationsModal slots. Google OAuth needs no
-- new secret-storage plumbing: it reuses upsert_integration/remove_integration
-- exactly like every other provider, storing the refresh token as the
-- Vault-backed secret and non-secret metadata (connected email, granted
-- scopes) in the existing jsonb `config` column.

alter table integrations drop constraint integrations_provider_check;
alter table integrations add constraint integrations_provider_check
  check (provider = any (array[
    'slack','teams','zoom','n8n','openai','anthropic','github','resend','gmail_inbound','google'
  ]));

-- Server-side-only accessor for the stored Google refresh token. Deliberately
-- NOT granted to anon/authenticated — this returns a raw, usable credential,
-- so only server code running with the service-role key may call it (the
-- same trust boundary SUPABASE_SERVICE_ROLE_KEY already carries elsewhere in
-- this app, e.g. src/lib/notifications/notify.ts).
create or replace function public.get_google_refresh_token(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret_id uuid;
  v_token text;
begin
  select credentials_enc::uuid into v_secret_id
  from integrations
  where tenant_id = p_tenant_id and provider = 'google' and is_active = true;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$function$;

revoke all on function public.get_google_refresh_token(uuid) from public, anon, authenticated;

-- Google Drive files attached to a task are external links, not objects in
-- Supabase Storage — attachments.file_url currently means "Storage path" for
-- every existing row (see attachments-repo.ts's getAttachmentSignedUrl,
-- which signs it as such). Adding a `source` discriminator + a real external
-- URL column keeps both kinds of attachment in the same table/UI without
-- overloading file_url's meaning.
alter table attachments add column if not exists source text not null default 'upload'
  check (source in ('upload', 'google_drive'));
alter table attachments add column if not exists external_url text;
