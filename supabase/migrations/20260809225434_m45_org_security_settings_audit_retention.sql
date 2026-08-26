alter table organizations
  add column audit_retention_days integer not null default 365,
  add column mfa_required boolean not null default false,
  add column sso_enabled boolean not null default false,
  add column sso_domain text;

alter table organizations
  add constraint organizations_audit_retention_days_check
  check (audit_retention_days between 30 and 3650);

create or replace function purge_expired_audit_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from audit_log a
  using organizations o
  where o.id = a.tenant_id
    and a.created_at < now() - (o.audit_retention_days || ' days')::interval;
end;
$$;

select cron.schedule('purge-expired-audit-logs', '0 3 * * *', 'select public.purge_expired_audit_logs();');
