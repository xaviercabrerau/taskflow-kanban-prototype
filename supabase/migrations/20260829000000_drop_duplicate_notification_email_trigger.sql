-- send_notification_email() + trg_notifications_send_email was a separate,
-- independent email-send path (reads the 'resend' integrations row via
-- Vault, calls Resend's API directly via net.http_post on every insert
-- into `notifications`) built before this session's notify.ts/resend-client.ts
-- pipeline existed. It's currently dormant (no one has configured a
-- 'resend' row via IntegrationsModal, so v_secret_id is always null and it
-- no-ops) but is a live duplicate-send hazard: the moment someone connects
-- Resend via IntegrationsModal, every notification (including the ones
-- notify.ts already emails via RESEND_API_KEY) would ALSO get emailed a
-- second time via this trigger, silently, with no error surfaced anywhere.
--
-- Dropped rather than left dormant: there is now exactly one notification
-- email path (src/lib/notifications/notify.ts), matching the
-- already-established convention (see notify.ts's own header comment) that
-- side effects like email live in one server-side place, not several.

drop trigger if exists notifications_after_insert_email on public.notifications;
drop function if exists public.trg_notifications_send_email();
drop function if exists public.send_notification_email(uuid);
