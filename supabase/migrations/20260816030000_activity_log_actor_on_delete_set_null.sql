-- activity_log.actor_id referenced auth.users(id) with no ON DELETE clause,
-- which blocks deleting any user who has ever performed a logged task action
-- (default RESTRICT). Switch to SET NULL so the audit trail entry survives
-- account deletion instead of preventing it.
alter table activity_log
  drop constraint activity_log_actor_id_fkey,
  add constraint activity_log_actor_id_fkey
    foreign key (actor_id) references auth.users(id) on delete set null;
