
-- log_task_activity() is a trigger function only, like execute_automation_rules(),
-- notify_task_status_changed() and check_task_move_permission(). Those all have
-- EXECUTE revoked from PUBLIC/anon/authenticated (only postgres/service_role can
-- call it), but CREATE FUNCTION grants EXECUTE to PUBLIC by default, so the new
-- function was left callable via PostgREST RPC. Match the existing pattern.

revoke execute on function public.log_task_activity() from public;
revoke execute on function public.log_task_activity() from anon;
revoke execute on function public.log_task_activity() from authenticated;
