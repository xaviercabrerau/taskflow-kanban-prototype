# TaskFlow — Production Deployment Guide

> **What this document covers:** the *routine* deployment of TaskFlow to the
> existing production environment (Vercel project `taskflow-kanban-prototype`
> → `https://task.conto.ec`), plus verification and rollback.
> **Where to go for anything else:**
> • Bringing a brand-new environment online for the first time →
> [`DEPLOYMENT_PLAN.md`](./DEPLOYMENT_PLAN.md)
> • Moving the project to different GitHub / Vercel / Supabase accounts →
> [`MIGRACION.md`](./MIGRACION.md)
> • Per-environment configuration checklist → [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md)
> • Where each environment variable comes from →
> [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md)
> • Project overview, stack and local setup → [`README.md`](./README.md)

**Last verified:** 2026-09-09 against the code, git, Vercel and Supabase.

---

## 0. Current production environment

| Item | Value |
|---|---|
| Public URL | `https://task.conto.ec` |
| Vercel project | `taskflow-kanban-prototype` |
| Vercel `projectId` | `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF` |
| Vercel `orgId` | `team_LUyGoTDapYDMjHCRVzQaFiaX` |
| Source repository | `github.com/xaviercabrerau/taskflow-kanban-prototype` |
| Deploy branch | `main` (worked on and deployed directly — no intermediate branch) |
| Supabase project ref | `txdyijyswpsalqnwfopc` |

> **Migration note:** these values belong to the accounts in use today. If the
> project moves to other GitHub / Vercel / Supabase accounts, follow
> [`MIGRACION.md`](./MIGRACION.md); do not edit them here piecemeal.

There is **no CI pipeline** in this repository (no `.github/workflows/`). Every
check below is run manually before pushing.

---

## 1. Pre-deployment checks (local, ~5 min)

Run all four from the repository root. All four must be green.

```bash
npx tsc --noEmit      # type check (there is no dedicated npm script)
npm run lint          # ESLint
npm test              # Jest — expected: 15 suites, 215 tests passing
npm run build         # production build (next build)
```

Then confirm configuration is complete: [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md).

Check production health *before* deploying, so that a post-deploy failure can
be attributed correctly:

```bash
curl -s https://task.conto.ec/api/health
# Expected: {"status":"ok","checks":{"supabase":{"ok":true,"latencyMs":<n>}},"timestamp":"..."}
```

`/api/health` returns HTTP 200 with `"status":"ok"` when Supabase is reachable,
and HTTP 503 with `"status":"error"` otherwise. It is safe to poll from an
uptime monitor at any frequency (it reads only the global `permissions`
catalog).

---

## 2. Database changes

Schema changes go **only** through versioned migration files in
`supabase/migrations/` (114 files as of 2026-09-09). Never apply raw SQL to the
remote project.

```bash
supabase link --project-ref txdyijyswpsalqnwfopc
supabase db push
```

Apply migrations **before** deploying code that depends on them. Verify:

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
select tablename, policyname from pg_policies where schemaname = 'public' order by tablename;
```

> **Migration note:** the `--project-ref` above is the current Supabase project.
> See [`MIGRACION.md`](./MIGRACION.md) if it changes.

---

## 3. Deploy

Vercel deploys from `main` through its native GitHub integration, so pushing is
usually enough:

```bash
git push origin main
```

To force a production deployment from your machine (Vercel CLI, already linked
through `.vercel/`):

```bash
vercel deploy --prod
```

Follow the build:

```bash
vercel logs --follow
```

---

## 4. Post-deployment verification

```bash
# 1. Service and database connectivity
curl -s https://task.conto.ec/api/health

# 2. Scheduled-job health (pg_cron job freshness)
curl -s https://task.conto.ec/api/health/cron
```

Then, in a browser:

- [ ] Sign in with a real account.
- [ ] The Kanban board at `/` loads with its columns and tasks.
- [ ] Create a task, move it between columns, add a comment.
- [ ] `/admin` opens as an organization owner and lists users.
- [ ] A notification email arrives (validates Resend and the verified sender
      domain).
- [ ] If the Google integrations are in use: `/admin/integraciones` still
      connects (validates the OAuth redirect URI).

### Cron jobs

`vercel.json` declares exactly **one** cron:

```json
{ "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
```

Daily at 08:00 UTC. It appears under *Vercel → Settings → Cron Jobs* after the
first production deployment. The endpoint authenticates the caller with
`CRON_SECRET` (sent as `Authorization: Bearer <CRON_SECRET>`, or as `?secret=`
for external monitors that cannot set custom headers). Any document claiming
additional crons in `vercel.json` is out of date.

---

## 5. Rollback

Rolling back is a Vercel-level operation; there is nothing to drain or flush.

```bash
# Promote the previous deployment
vercel rollback

# Or revert the code and redeploy
git revert <sha>
git push origin main
```

Then re-check `/api/health`.

**Database rollback is not automatic.** A migration that must be undone needs a
*new* migration file that reverses it — never edit or delete an applied
migration. Restore from a Supabase backup (*Database → Backups*) only as a last
resort, and only with the data loss window understood.

---

## 6. Notes and gotchas

- **The `xlsx` dependency is installed from the SheetJS CDN**
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), not from the npm
  registry, because the npm-published version carries two unpatched HIGH
  vulnerabilities (prototype pollution and ReDoS). This is deliberate: the
  build machine must be able to reach that CDN, and this must **not** be
  "fixed" by switching to `xlsx: ^0.18.5`.
- **Node.js ≥ 20.9.0** is required (Next.js 16).
- **`vercel env pull` overwrites `.env.local`.** Back it up first if it holds
  values that are not in Vercel.
- **`org_role` is not RBAC.** `organization_members.org_role` gates the admin
  panel; the RLS policies that gate content mutations read `role_assignments`.
  A newly created user with `org_role = 'admin'` but no `role_assignments` row
  cannot create tasks. Worth re-testing after any deployment that touches user
  provisioning.
- The historical documents `BLOCKERS_RESOLUTION.md`, `BLOCKERS_FIXED.md`,
  `VALIDATION_REPORT.md`, `docs/PRODUCTION_READINESS_CHECKLIST.md` and
  `verify-blockers-fixed.sh` come from a 2026-08-18 planning exercise around
  services this project never wired up (Slack alerting, PagerDuty, Twilio,
  Datadog, a BullMQ worker). They are kept for history and are **not** part of
  this procedure.

---

## 7. Monitoring after release

Active monitoring is documented in [`OBSERVABILITY.md`](./OBSERVABILITY.md).
In short, what exists today:

- `/api/health` and `/api/health/cron` as probes.
- `/api/cron/alert-check`, which posts failures to `ALERT_WEBHOOK_URL`
  (a Slack/Discord-style incoming webhook) when a check fails.
- Sentry is instrumented (`@sentry/nextjs`) but has no DSN configured, so error
  tracking is effectively off until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are
  set.
- Vercel's own build and function logs (`vercel logs`).
