drop policy if exists integrations_all on integrations;

create policy integrations_select on integrations
  for select
  using (is_org_member(tenant_id));

create policy integrations_write on integrations
  for all
  using (is_org_owner(tenant_id))
  with check (is_org_owner(tenant_id));

alter table integrations
  add constraint integrations_tenant_provider_key unique (tenant_id, provider);

create or replace function upsert_integration(
  p_tenant_id uuid,
  p_provider text,
  p_config jsonb,
  p_secret text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
begin
  if not is_org_owner(p_tenant_id) then
    raise exception 'No autorizado para configurar integraciones de esta organización';
  end if;

  select id, credentials_enc::uuid into v_existing_id, v_existing_secret_id
  from integrations
  where tenant_id = p_tenant_id and provider = p_provider;

  if p_secret is null then
    v_new_secret_id := v_existing_secret_id;
  elsif p_secret = '' then
    if v_existing_secret_id is not null then
      delete from vault.secrets where id = v_existing_secret_id;
    end if;
    v_new_secret_id := null;
  elsif v_existing_secret_id is not null then
    perform vault.update_secret(v_existing_secret_id, p_secret);
    v_new_secret_id := v_existing_secret_id;
  else
    v_new_secret_id := vault.create_secret(p_secret, p_provider || ':' || p_tenant_id::text);
  end if;

  insert into integrations (tenant_id, provider, config, is_active, credentials_enc)
  values (p_tenant_id, p_provider, coalesce(p_config, '{}'::jsonb), p_is_active, v_new_secret_id::text)
  on conflict (tenant_id, provider)
  do update set
    config = excluded.config,
    is_active = excluded.is_active,
    credentials_enc = excluded.credentials_enc;
end;
$$;

grant execute on function upsert_integration(uuid, text, jsonb, text, boolean) to authenticated;

create or replace function remove_integration(p_integration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_secret_id uuid;
begin
  select tenant_id, credentials_enc::uuid into v_tenant_id, v_secret_id
  from integrations where id = p_integration_id;

  if v_tenant_id is null then
    return;
  end if;
  if not is_org_owner(v_tenant_id) then
    raise exception 'No autorizado para eliminar esta integración';
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  delete from integrations where id = p_integration_id;
end;
$$;

grant execute on function remove_integration(uuid) to authenticated;
