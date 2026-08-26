alter table public.comments drop constraint comments_source_check;
alter table public.comments add constraint comments_source_check
  check (source = any (array['web'::text, 'email'::text, 'mcp_agent'::text, 'automation'::text]));
