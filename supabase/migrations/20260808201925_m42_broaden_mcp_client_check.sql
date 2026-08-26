alter table public.mcp_sessions drop constraint mcp_sessions_client_check;
alter table public.mcp_sessions add constraint mcp_sessions_client_check
  check (client = any (array['claude_chat'::text, 'claude_cowork'::text, 'claude_desktop'::text, 'claude_code'::text, 'other'::text]));
