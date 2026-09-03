-- Fase 4: acceso de invitado/cliente + links públicos de solo lectura.
-- Modelo unificado: una fila en public_share_links representa un token
-- compartible hacia una tarea o un tablero completo, con permiso view|comment.
-- El token en texto plano nunca se persiste — mismo patrón que
-- mcp_sessions.token_hash / webhooks_inbound.token_hash: se genera dentro de
-- una función SECURITY DEFINER con pgcrypto y solo se devuelve una vez.

create table public_share_links (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references organizations(id) on delete cascade,
  board_id          uuid not null references boards(id) on delete cascade,
  task_id           uuid references tasks(id) on delete cascade,
  scope             text not null check (scope in ('board','task')),
  permission        text not null default 'view' check (permission in ('view','comment')),
  token_hash        text not null unique,
  label             text,
  created_by        uuid references auth.users(id),
  expires_at        timestamptz,
  revoked_at        timestamptz,
  last_accessed_at  timestamptz,
  created_at        timestamptz not null default now(),
  constraint public_share_links_task_scope check (
    (scope = 'task' and task_id is not null) or (scope = 'board' and task_id is null)
  )
);

create index public_share_links_tenant_idx on public_share_links(tenant_id);
create index public_share_links_board_idx on public_share_links(board_id);
create index public_share_links_task_idx on public_share_links(task_id);

alter table public_share_links enable row level security;
create policy public_share_links_all on public_share_links for all using (public.is_org_member(tenant_id));

-- Comentarios de invitados reutilizan la tabla comments (misma UI, mismo hilo
-- que los comentarios de miembros): source='guest' los distingue, guest_name
-- guarda el nombre que el invitado escribió (author_id queda null, no hay
-- fila en auth.users para un visitante anónimo).
alter table comments drop constraint comments_source_check;
alter table comments add constraint comments_source_check check (source in ('web','email','mcp_agent','guest'));
alter table comments add column guest_name text;

-- Crea un link compartible. SECURITY DEFINER solo para poder generar y
-- hashear el token del lado servidor sin exponer pgcrypto al cliente; sigue
-- exigiendo autenticación y membresía real de organización antes de insertar,
-- igual que create_mcp_session/create_inbound_webhook.
create or replace function public.create_share_link(
  p_board_id uuid,
  p_task_id uuid,
  p_scope text,
  p_permission text,
  p_expires_at timestamptz,
  p_label text
)
returns table(link_id uuid, token text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_token text;
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;
  if p_scope not in ('board','task') then
    raise exception 'scope inválido';
  end if;
  if p_permission not in ('view','comment') then
    raise exception 'permission inválido';
  end if;
  if p_scope = 'task' and p_task_id is null then
    raise exception 'task_id requerido para scope=task';
  end if;

  select b.tenant_id into v_tenant_id
  from boards b
  where b.id = p_board_id and public.is_org_member(b.tenant_id);
  if v_tenant_id is null then
    raise exception 'tablero no encontrado o sin permiso';
  end if;

  if p_task_id is not null then
    if not exists (select 1 from tasks t where t.id = p_task_id and t.board_id = p_board_id) then
      raise exception 'tarea no encontrada en este tablero';
    end if;
  end if;

  v_token := 'tfshare_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public_share_links (tenant_id, board_id, task_id, scope, permission, token_hash, label, created_by, expires_at)
  values (v_tenant_id, p_board_id, p_task_id, p_scope, p_permission, v_hash, nullif(trim(p_label), ''), auth.uid(), p_expires_at)
  returning id into v_id;

  return query select v_id, v_token;
end;
$function$;

revoke all on function public.create_share_link(uuid, uuid, text, text, timestamptz, text) from public;
grant execute on function public.create_share_link(uuid, uuid, text, text, timestamptz, text) to authenticated;

-- Resuelve un link público para un visitante anónimo. SECURITY DEFINER
-- porque el rol `anon` no tiene acceso RLS a boards/tasks/comments; expone
-- deliberadamente solo los campos necesarios para una vista de solo lectura
-- de UNA tarea o UN tablero — nunca datos de otras tareas/tenants.
create or replace function public.resolve_share_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_link public_share_links%rowtype;
  v_result jsonb;
begin
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into v_link from public_share_links
  where token_hash = v_hash and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_link.id is null then
    raise exception 'link inválido o expirado';
  end if;

  update public_share_links set last_accessed_at = now() where id = v_link.id;

  if v_link.scope = 'task' then
    select jsonb_build_object(
      'scope', 'task',
      'permission', v_link.permission,
      'boardName', b.name,
      'task', jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'priority', t.priority,
        'dueDate', t.due_date,
        'columnLabel', bc.label,
        'createdAt', t.created_at
      ),
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'body', c.body, 'source', c.source,
          'guestName', c.guest_name, 'createdAt', c.created_at
        ) order by c.created_at asc)
        from comments c where c.task_id = t.id
      ), '[]'::jsonb)
    ) into v_result
    from tasks t
    join boards b on b.id = t.board_id
    join board_columns bc on bc.id = t.column_id
    where t.id = v_link.task_id;
  else
    select jsonb_build_object(
      'scope', 'board',
      'permission', v_link.permission,
      'boardName', b.name,
      'columns', coalesce((
        select jsonb_agg(jsonb_build_object('id', bc.id, 'label', bc.label, 'orderIndex', bc.order_index) order by bc.order_index)
        from board_columns bc where bc.board_id = b.id
      ), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'priority', t.priority,
          'dueDate', t.due_date, 'columnId', t.column_id
        ))
        from tasks t where t.board_id = b.id and t.parent_task_id is null
      ), '[]'::jsonb)
    ) into v_result
    from boards b
    where b.id = v_link.board_id;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text) to anon, authenticated;

-- Comenta como invitado. Solo funciona sobre links scope=task con
-- permission=comment; cualquier otro caso lanza excepción explícita.
create or replace function public.add_share_link_comment(p_token text, p_body text, p_guest_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_link public_share_links%rowtype;
  v_comment_id uuid;
  v_created_at timestamptz;
begin
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'comentario inválido';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into v_link from public_share_links
  where token_hash = v_hash and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_link.id is null then
    raise exception 'link inválido o expirado';
  end if;
  if v_link.scope <> 'task' or v_link.permission <> 'comment' then
    raise exception 'este link no permite comentarios';
  end if;

  insert into comments (task_id, author_id, body, source, guest_name)
  values (v_link.task_id, null, p_body, 'guest', coalesce(nullif(trim(p_guest_name), ''), 'Invitado'))
  returning id, created_at into v_comment_id, v_created_at;

  update public_share_links set last_accessed_at = now() where id = v_link.id;

  return jsonb_build_object('id', v_comment_id, 'createdAt', v_created_at);
end;
$function$;

revoke all on function public.add_share_link_comment(text, text, text) from public;
grant execute on function public.add_share_link_comment(text, text, text) to anon, authenticated;

-- Lista/revoca: se hacen con select/update directos sobre public_share_links
-- desde el cliente autenticado (RLS public_share_links_all ya limita a
-- miembros de la organización), no necesitan RPC propia.
