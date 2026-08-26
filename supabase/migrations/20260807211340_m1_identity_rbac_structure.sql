-- 7.1 Identidad y Organización
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  plan        text not null default 'free' check (plan in ('free','pro','enterprise')),
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Identidad de usuario delegada a Supabase Auth (auth.users). `profiles` guarda
-- solo los metadatos de aplicación que el plan pedía en `users` (full_name,
-- avatar_url, status). password_hash/mfa_secret/oauth_accounts se omiten
-- deliberadamente: Supabase Auth ya los gestiona internamente (auth.users,
-- auth.mfa_factors, auth.identities) y duplicarlos sería una fuente de
-- desincronización y un riesgo de seguridad.
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text,
  avatar_url     text,
  status         text not null default 'active' check (status in ('active','invited','suspended')),
  last_login_at  timestamptz,
  created_at     timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  org_role         text not null default 'member' check (org_role in ('owner','admin','member','guest')),
  invited_by       uuid references auth.users(id),
  joined_at        timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_org_members_user on organization_members(user_id);

-- Helper de RLS: ¿el usuario autenticado pertenece a esta organización?
create function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id and user_id = auth.uid()
  );
$$;

-- 7.2 RBAC
create table roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references organizations(id) on delete cascade, -- null = rol de sistema
  name        text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table permissions (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  description  text,
  category     text not null check (category in ('task','board','workspace','admin'))
);

create table role_permissions (
  role_id        uuid not null references roles(id) on delete cascade,
  permission_id  uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table role_assignments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role_id      uuid not null references roles(id) on delete cascade,
  scope_type   text not null check (scope_type in ('workspace','board')),
  scope_id     uuid not null,
  granted_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (user_id, scope_type, scope_id)
);

-- 7.3 Estructura de trabajo
create table board_templates (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references organizations(id) on delete cascade,
  name                  text not null,
  default_columns       jsonb not null default '[]',
  custom_field_schema   jsonb not null default '[]',
  default_automations   jsonb not null default '[]',
  default_views         text[] not null default array['kanban']
);

create table workspaces (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references organizations(id) on delete cascade,
  name         text not null,
  icon         text,
  color        text,
  template_id  uuid references board_templates(id),
  created_at   timestamptz not null default now()
);

create table boards (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references organizations(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  archived     boolean not null default false,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create table board_columns (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references boards(id) on delete cascade,
  key            text not null,
  label          text not null,
  color          text,
  order_index    int not null default 0,
  is_done_state  boolean not null default false
);

create table custom_field_definitions (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references boards(id) on delete cascade,
  key           text not null,
  label         text not null,
  field_type    text not null check (field_type in ('text','number','date','select','multiselect','user','currency')),
  options       jsonb,
  is_required   boolean not null default false,
  order_index   int not null default 0
);

create index idx_workspaces_tenant on workspaces(tenant_id);
create index idx_boards_tenant on boards(tenant_id);
create index idx_boards_workspace on boards(workspace_id);
create index idx_board_columns_board on board_columns(board_id, order_index);
