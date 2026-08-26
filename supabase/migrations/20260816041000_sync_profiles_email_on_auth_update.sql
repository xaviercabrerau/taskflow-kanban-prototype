-- profiles.email is denormalized from auth.users.email (m10) but only ever
-- populated at signup via handle_new_user(). If a user changes their email
-- in Supabase Auth, profiles.email goes stale forever, and both
-- send_notification_email() and the invite-by-email flow keep operating on
-- the old address. Add the missing after-update sync trigger.
create or replace function public.handle_user_email_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute procedure public.handle_user_email_update();
