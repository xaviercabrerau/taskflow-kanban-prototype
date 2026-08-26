-- Widen integrations.provider to allow the two new providers backing the
-- Gmail-integration groundwork: 'resend' (real outbound email, sends today)
-- and 'gmail_inbound' (config/readiness only — actual Gmail Push/OAuth needs
-- a real Google Workspace admin, same limitation already documented for SSO).
alter table integrations drop constraint integrations_provider_check;
alter table integrations add constraint integrations_provider_check
  check (provider = any (array['slack','teams','zoom','n8n','openai','anthropic','github','resend','gmail_inbound']));

-- Best-effort outbound email sender for a single notification row. Never
-- raises: a failed/misconfigured email integration must not break the
-- in-app notification, which is already persisted by the time this runs.
create or replace function public.send_notification_email(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_user_id uuid;
  v_title text;
  v_body text;
  v_recipient_email text;
  v_secret_id uuid;
  v_config jsonb;
  v_api_key text;
  v_from_email text;
begin
  select tenant_id, user_id, title, body
    into v_tenant_id, v_user_id, v_title, v_body
  from notifications
  where id = p_notification_id;

  if v_tenant_id is null then
    return;
  end if;

  select email into v_recipient_email from profiles where id = v_user_id;
  if v_recipient_email is null then
    return;
  end if;

  select credentials_enc::uuid, config into v_secret_id, v_config
  from integrations
  where tenant_id = v_tenant_id and provider = 'resend' and is_active = true;

  if v_secret_id is null then
    return;
  end if;

  select decrypted_secret into v_api_key from vault.decrypted_secrets where id = v_secret_id;
  if v_api_key is null then
    return;
  end if;

  v_from_email := coalesce(v_config->>'fromEmail', 'notificaciones@taskflow.app');

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', v_from_email,
      'to', jsonb_build_array(v_recipient_email),
      'subject', v_title,
      'html', '<p>' || coalesce(v_body, v_title) || '</p>'
    )
  );
exception when others then
  return;
end;
$function$;

create or replace function public.trg_notifications_send_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform send_notification_email(new.id);
  return new;
end;
$function$;

drop trigger if exists notifications_after_insert_email on notifications;
create trigger notifications_after_insert_email
  after insert on notifications
  for each row execute function trg_notifications_send_email();
