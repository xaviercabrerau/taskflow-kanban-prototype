-- Fase 5: integración GitHub — vincular issues/PRs a una tarea. Requiere
-- que la organización guarde un Personal Access Token de GitHub en
-- /admin/integraciones (provider 'github', ya soportado por
-- upsert_integration/IntegrationsModal desde antes de esta migración);
-- sin ese token, el endpoint que usa get_github_token responde "no
-- configurado" — ver src/app/api/tasks/[id]/github-link/route.ts.

create table task_github_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  tenant_id  uuid not null references organizations(id) on delete cascade,
  url        text not null,
  repo       text not null,   -- "owner/repo"
  number     int not null,
  kind       text not null check (kind in ('issue', 'pull_request')),
  title      text not null,
  state      text not null,   -- 'open' | 'closed' | 'merged', tal como lo reporta la API de GitHub
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index task_github_links_task_idx on task_github_links(task_id);

alter table task_github_links enable row level security;
create policy task_github_links_all on task_github_links for all using (public.is_org_member(tenant_id));

-- Accesor server-only para el PAT de GitHub — mismo patrón que
-- get_google_refresh_token / get_ai_credential: revocado de anon/authenticated,
-- solo invocable con la service-role key.
create or replace function public.get_github_token(p_tenant_id uuid)
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
  where tenant_id = p_tenant_id and provider = 'github' and is_active = true;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$function$;

revoke all on function public.get_github_token(uuid) from public, anon, authenticated;
