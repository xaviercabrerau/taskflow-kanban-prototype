alter table public.audit_log drop constraint audit_log_source_check;
alter table public.audit_log add constraint audit_log_source_check
  check (source = any (array['web'::text, 'api'::text, 'mcp_agent'::text, 'automation'::text, 'webhook_inbound'::text]));
