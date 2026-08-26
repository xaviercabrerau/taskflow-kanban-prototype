-- check_task_move_permission solo debe ejecutarse como trigger BEFORE UPDATE
-- en tasks, nunca invocada directamente vía RPC (revocado igual que se hizo
-- con handle_new_user/is_org_member en m5/m6).
revoke execute on function public.check_task_move_permission() from anon, authenticated, public;
