-- Revoke anon EXECUTE from SECURITY DEFINER functions that assume an
-- authenticated Supabase session (auth.uid()) and are only ever called by
-- the app's authenticated client, never by the unauthenticated MCP/webhook
-- token-based flows (those flows self-validate a p_token argument instead
-- of relying on auth.uid(), and intentionally keep their anon grant).
revoke execute on function public.is_org_member(uuid) from anon;
revoke execute on function public.is_org_owner(uuid) from anon;
revoke execute on function public.list_org_members(uuid) from anon;
revoke execute on function public.create_mcp_session(text, text, text[]) from anon;
revoke execute on function public.revoke_mcp_session(uuid) from anon;
revoke execute on function public.increment_template_install_count(uuid) from anon;
revoke execute on function public.remove_integration(uuid) from anon;
revoke execute on function public.upsert_integration(uuid, text, jsonb, text, boolean) from anon;
revoke execute on function public.record_daily_metrics_snapshot(uuid) from anon;

-- These three are never called from client code at all: purge_expired_audit_logs
-- runs via a nightly pg_cron job, and send_notification_email/trg_notifications_send_email
-- are only invoked internally by the notifications insert trigger. Neither anon
-- nor authenticated needs client-callable access to them.
revoke execute on function public.purge_expired_audit_logs() from anon, authenticated;
revoke execute on function public.send_notification_email(uuid) from anon, authenticated;
revoke execute on function public.trg_notifications_send_email() from anon, authenticated;
