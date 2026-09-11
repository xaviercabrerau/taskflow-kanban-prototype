# Audit Logging

**Last verified against the code:** 2026-09-09 (`supabase/migrations/`,
`src/lib/supabase/org-settings-repo.ts`, `src/components/AuditExportModal.tsx`,
`src/app/admin/auditoria/page.tsx`).

This document describes the audit trail TaskFlow **actually has**. Section 6 lists what
a full GDPR compliance programme would additionally require — those parts are *not*
implemented, and are marked as such.

> Earlier versions of this file described an `audit_logs` table (plural) with
> partitioning, a `data_deletion_audit` table, a `login_attempts` table, an
> `AuditLogger` TypeScript class and a middleware that logged every request. **None of
> that exists in this codebase.** It was an implementation proposal that was never
> built; the design that shipped is the database-side one below.

---

## 1. What exists

Two tables, with different jobs:

| Table | Scope | Purpose |
|---|---|---|
| `audit_log` | tenant | Security/compliance trail of privileged and machine-originated actions. **Append-only, enforced by RLS.** |
| `activity_log` | task | Per-task activity feed shown in the UI (who did what to this task). Not a security log. |

### `audit_log` schema

Created in `20260807211357_m2_tasks_collaboration.sql`:

```sql
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references organizations(id) on delete cascade,
  actor_id       uuid references auth.users(id),      -- null = system/machine actor
  source         text not null,                        -- see check constraint below
  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  ip_address     inet,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index idx_audit_log_tenant on audit_log(tenant_id, created_at desc);
create index idx_audit_log_actor_id on public.audit_log (actor_id);
```

`actor_id` is `on delete set null` (`20260816031500_actor_fks_on_delete_set_null.sql`),
so deleting a user does not delete the audit trail of what that user did — the entry
survives with an anonymous actor.

`source` is constrained to
`'web' | 'api' | 'mcp_agent' | 'automation' | 'webhook_inbound'`
(widened for inbound webhooks in
`20260808200908_m39_allow_webhook_inbound_audit_source.sql`).

### `activity_log` schema

```sql
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

RLS: readable/writable by any member of the organization that owns the task. It is a
product feature, not a tamper-evident record — do not treat it as an audit trail.

---

## 2. Append-only, enforced by the database

`20260807211451_m4_enable_rls_policies.sql`:

```sql
alter table audit_log enable row level security;
create policy audit_log_select on audit_log for select using (public.is_org_member(tenant_id));
create policy audit_log_insert on audit_log for insert with check (public.is_org_member(tenant_id));
-- no UPDATE policy, no DELETE policy
```

With RLS enabled and no `UPDATE`/`DELETE` policy, those commands are **denied by default
for every application role**. Append-only is enforced by Postgres, not by convention.

Deletion happens only through `purge_expired_audit_logs()`, a `SECURITY DEFINER`
function owned by `postgres` (section 4).

Consequences worth knowing:

- The service-role key bypasses RLS and *can* delete rows. Keep its call sites minimal.
- Corrections cannot be edits. A wrong entry is fixed by appending a compensating entry.

---

## 3. What gets logged today

Audit entries are written **inside `SECURITY DEFINER` Postgres functions**, not by
application middleware. That is deliberate: a caller cannot perform the action and skip
the log, because both happen in the same function.

| `source` | `action` | Written by |
|---|---|---|
| `mcp_agent` | `task_created_from_mcp` | `mcp_create_task` RPC |
| `mcp_agent` | `task_moved_from_mcp` | `mcp_move_task` RPC |
| `mcp_agent` | `comment_added_from_mcp` | `mcp_add_comment` RPC |
| `webhook_inbound` | `task_created_from_webhook` | `ingest_webhook_task` RPC |
| `webhook_inbound` | `task_updated_from_webhook` | `ingest_webhook_task` RPC (CRM upsert path, matched on `external_ticket_id`) |

`resource_type` is `task` for all of the above; `metadata` carries the context
(`session_id`, `client`, `webhook_id`, `external_ticket_id`).

**Known coverage gap:** ordinary web-UI mutations are **not** audited. Board and task
changes go client → Supabase directly and are authorized by RLS, with no
`SECURITY DEFINER` wrapper to log from — so `source = 'web'` entries are essentially
absent, even though the constraint allows them. Administrative actions (creating a user,
resetting a password, changing an `org_role`) are likewise **not** written to
`audit_log`. Anyone extending the audit trail should add the insert inside a
`SECURITY DEFINER` function or a database trigger, not in a route handler, so it cannot
be bypassed.

---

## 4. Retention

Retention is **per organization**, stored on the `organizations` row
(`20260809225434_m45_org_security_settings_audit_retention.sql`):

```sql
alter table organizations add column audit_retention_days integer not null default 365;
alter table organizations add constraint organizations_audit_retention_days_check
  check (audit_retention_days between 30 and 3650);
```

Enforcement is a `pg_cron` job, daily at 03:00:

```sql
create or replace function purge_expired_audit_logs() ... security definer ... as $$
begin
  delete from audit_log a using organizations o
  where o.id = a.tenant_id
    and a.created_at < now() - (o.audit_retention_days || ' days')::interval;
end;
$$;

select cron.schedule('purge-expired-audit-logs', '0 3 * * *', 'select public.purge_expired_audit_logs();');
```

Because the job lives in Postgres, it is created by the migration and re-created
automatically when the migrations are re-run against a new Supabase project — but it
does **not** move with a Vercel migration. `/api/health/cron` reports its state; the
expected job list is in `src/lib/cron-jobs.ts`.

Owners change the value from the UI (section 5), which writes
`organizations.audit_retention_days` via `updateOrgSettings()` in
`src/lib/supabase/org-settings-repo.ts`.

---

## 5. Viewing and exporting

`/admin/auditoria` renders `AuditExportModal` in embedded mode. It provides:

- the tenant's recent audit entries (`fetchAuditLog()` — newest first, default limit
  500, optional `from`/`to` range),
- **CSV export** of the selected range, downloaded client-side as
  `audit-log-export-YYYY-MM-DD.csv` with the header
  `fecha,actor,fuente,accion,recurso`. Actor ids are resolved to member names; an entry
  with no `actor_id` is shown as `Sistema`.
- the retention control (`audit_retention_days`, 30–3650).

Reads are tenant-scoped by the `audit_log_select` RLS policy, so a user only ever
exports their own organization's entries.

There is no server-side export endpoint — the CSV is built in the browser from rows the
client already fetched under RLS.

### Direct queries

```sql
-- Everything a given actor did, newest first
select created_at, source, action, resource_type, resource_id, metadata
from audit_log
where tenant_id = $1 and actor_id = $2
order by created_at desc
limit 100;

-- Machine-originated activity in the last 24h (MCP agents + inbound webhooks)
select created_at, source, action, resource_id, metadata
from audit_log
where tenant_id = $1
  and source in ('mcp_agent', 'webhook_inbound')
  and created_at > now() - interval '24 hours'
order by created_at desc;

-- Everything that happened to one task
select created_at, actor_id, source, action
from audit_log
where tenant_id = $1 and resource_type = 'task' and resource_id = $2
order by created_at desc;
```

---

## 6. Not implemented (gaps against a full compliance programme)

If TaskFlow ever needs to demonstrate GDPR/CCPA compliance, these are missing. They are
listed as work items, not as descriptions of the system:

- **Web and admin action coverage** — see the gap in section 3. Without it the audit
  trail covers machine actors far better than humans.
- **Data-access logging** — reads of personal data are not recorded anywhere.
- **Failed-login tracking / account lockout** — no `login_attempts` table; Supabase Auth
  handles authentication and its own logs are the only record.
- **Right-to-erasure trail** — no `data_deletion_audit` table, no deletion request
  workflow, no verification hashes. Deleting a user removes the membership and nulls
  `audit_log.actor_id`; nothing records that an erasure request was fulfilled.
- **Subject Access Request tooling** — no endpoint or process to collect and export one
  person's data across tables.
- **IP address capture** — the `ip_address` column exists but the current writers do not
  populate it.
- **Anonymization on ageing** — entries are deleted wholesale at the retention horizon;
  there is no intermediate "scrub identifying fields" step.
- **Immutability beyond RLS** — no hash chaining, WORM storage, or off-site copy. A
  service-role credential can still delete rows.

Related documents: [`PII_SCRUBBING.md`](./PII_SCRUBBING.md) (what is stripped from error
reports), [`PRIVACY_POLICY.md`](../PRIVACY_POLICY.md) (the public commitments).

---

## 7. Rules for extending the audit trail

1. Write the entry **inside** the `SECURITY DEFINER` function or trigger that performs
   the action, so it cannot be skipped.
2. Use an existing `source` value, or widen the check constraint **in a new migration**
   first — an unlisted value raises a constraint violation and aborts the action it was
   meant to record.
3. Never `UPDATE` or `DELETE` `audit_log`. Append a compensating entry instead.
4. Put context in `metadata` (jsonb) rather than encoding it into the `action` string.
5. Keep personal data out of `metadata` — the row is retained for up to
   `audit_retention_days` and is exported to CSV by owners.
6. Schema changes only through versioned files in `supabase/migrations/`.

---

> **Migration note:** the retention cron and the audit trail live entirely inside
> Supabase. Moving to another Supabase project re-creates the table and the `pg_cron`
> job from the migrations, but **existing audit rows are only carried over if the data
> dump includes them** — see [`MIGRACION.md`](../MIGRACION.md).
