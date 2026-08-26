-- sso_domain had no uniqueness guard: two orgs could claim the same domain,
-- which would matter the moment any SSO domain-routing logic is added.
create unique index if not exists organizations_sso_domain_unique
  on organizations (lower(sso_domain))
  where sso_domain is not null;

-- increment_template_install_count() was callable by anon per the Supabase
-- security advisor, with no protection at all — anyone could inflate a
-- marketplace template's install_count. The app only ever calls it via the
-- authenticated client (templates-repo.ts), never anon, so this is safe to
-- revoke. (get_cron_health() is deliberately NOT touched here — the health
-- route calls it with the anon key by design, protected by an app-level
-- CRON_SECRET check before the RPC call; revoking anon there would break
-- that route.)
revoke execute on function public.increment_template_install_count(uuid) from anon;
