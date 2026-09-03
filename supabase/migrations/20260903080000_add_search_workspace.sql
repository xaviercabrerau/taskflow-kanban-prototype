-- Roadmap Fase 2, item 4: búsqueda global (no solo título dentro del
-- tablero abierto). Covers task titles/descriptions, comment bodies, and
-- attachment file names for a given board.
--
-- Deliberately SECURITY INVOKER (the default — no `security definer`
-- here): the function runs under the calling user's own privileges, so the
-- existing RLS policies on tasks/comments/attachments apply exactly as if
-- the caller had queried those tables directly. No new access is granted.
create or replace function public.search_workspace(p_board_id uuid, p_query text)
returns table (
  task_id uuid,
  task_title text,
  match_type text,
  snippet text
)
language sql
stable
set search_path = public
as $$
  select t.id, t.title, 'task'::text, t.title
  from tasks t
  where t.board_id = p_board_id
    and (t.title ilike '%' || p_query || '%' or t.description ilike '%' || p_query || '%')

  union all

  select t.id, t.title, 'comment'::text, left(c.body, 140)
  from comments c
  join tasks t on t.id = c.task_id
  where t.board_id = p_board_id
    and c.body ilike '%' || p_query || '%'

  union all

  select t.id, t.title, 'attachment'::text, a.file_name
  from attachments a
  join tasks t on t.id = a.task_id
  where t.board_id = p_board_id
    and a.file_name ilike '%' || p_query || '%'

  limit 30;
$$;

revoke execute on function public.search_workspace(uuid, text) from public;
grant execute on function public.search_workspace(uuid, text) to authenticated;
