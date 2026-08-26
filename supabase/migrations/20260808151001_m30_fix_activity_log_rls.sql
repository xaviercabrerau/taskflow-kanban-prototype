
-- activity_log_all was a single FOR ALL policy with only a USING clause.
-- Since no WITH CHECK was specified, Postgres reuses the USING qual for
-- WITH CHECK too, which meant any org member could UPDATE/DELETE rows
-- directly via the client (PostgREST) — not append-only.
-- Replace it with the audit_log pattern: SELECT for org members,
-- INSERT for org members (scoped to their own tasks), no UPDATE/DELETE
-- policy at all (default deny for those commands from the client).

drop policy if exists activity_log_all on public.activity_log;

create policy activity_log_select
  on public.activity_log
  for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = activity_log.task_id
        and public.is_org_member(t.tenant_id)
    )
  );

create policy activity_log_insert
  on public.activity_log
  for insert
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = activity_log.task_id
        and public.is_org_member(t.tenant_id)
    )
  );
