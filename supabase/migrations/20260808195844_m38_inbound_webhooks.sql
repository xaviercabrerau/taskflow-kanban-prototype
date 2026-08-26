create table public.webhooks_inbound (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.board_columns(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.webhooks_inbound enable row level security;

create policy webhooks_inbound_select on public.webhooks_inbound
  for select using (is_org_owner(tenant_id));
create policy webhooks_inbound_insert on public.webhooks_inbound
  for insert with check (is_org_owner(tenant_id));
create policy webhooks_inbound_update on public.webhooks_inbound
  for update using (is_org_owner(tenant_id)) with check (is_org_owner(tenant_id));
create policy webhooks_inbound_delete on public.webhooks_inbound
  for delete using (is_org_owner(tenant_id));

create or replace function public.ingest_webhook_task(
  p_token text,
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
  p_due_date timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hook record;
  new_task_id uuid;
  next_position numeric;
begin
  select * into hook from webhooks_inbound where token = p_token and is_active limit 1;
  if hook.id is null then
    raise exception 'webhook inválido o inactivo';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title es requerido';
  end if;

  if p_priority not in ('high', 'medium', 'low') then
    p_priority := 'medium';
  end if;

  select coalesce(max(position), 0) + 1 into next_position
  from tasks where column_id = hook.column_id;

  insert into tasks (tenant_id, board_id, column_id, title, description, priority, due_date, position)
  values (hook.tenant_id, hook.board_id, hook.column_id, p_title, p_description, p_priority, p_due_date, next_position)
  returning id into new_task_id;

  insert into audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
  values (hook.tenant_id, null, 'webhook_inbound', 'task_created_from_webhook', 'task', new_task_id,
          jsonb_build_object('webhook_id', hook.id));

  return new_task_id;
end;
$function$;

revoke all on function public.ingest_webhook_task(text, text, text, text, timestamptz) from public;
grant execute on function public.ingest_webhook_task(text, text, text, text, timestamptz) to anon, authenticated;
