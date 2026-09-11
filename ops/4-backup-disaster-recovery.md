# Backup & Disaster Recovery — TaskFlow

**Status:** executable procedures, verified against this repository on 2026-09-09.
**Scope:** TaskFlow Kanban (Next.js on Vercel + Supabase). This replaces an earlier
version of this document that described a self-hosted Kubernetes / Redis / S3 /
BullMQ system that does not exist here — none of those commands could be run.

> **Migration note:** the account-bound values in this document (Supabase project
> ref `txdyijyswpsalqnwfopc`, Vercel project/org IDs, the domain `task.conto.ec`,
> the GitHub repo) belong to the **current** accounts. If the project is moved to
> different accounts, see [`MIGRACION.md`](../MIGRACION.md) for the full migration
> procedure. Section 6.2 below ("Rebuild into a new Supabase project") is also the
> core of a migration: a migration is a restore into accounts you control.

---

## 1. What actually has to be backed up

TaskFlow keeps almost no state of its own. Everything that matters is in Supabase,
in Vercel's environment variables, or already versioned in git.

| Asset | Where it lives | In git? | Backup needed |
|---|---|---|---|
| Database **schema** | 114 migration files in `supabase/migrations/` | **Yes** | No — git *is* the backup |
| Database **data** (tasks, boards, comments, orgs, audit log…) | Supabase Postgres, project `txdyijyswpsalqnwfopc` | No | **Yes — critical** |
| **Auth users** (`auth.users`, incl. password hashes) | Supabase Auth (`auth` schema) | No | **Yes — critical** |
| **File attachments** | Supabase Storage, private bucket `task-attachments` | No | **Yes** |
| **Secrets / env vars** | Vercel project env vars (names listed in `.env.example`) | Names only | **Yes — values only exist in Vercel + the source services** |
| Cron schedule (Vercel) | `vercel.json` | **Yes** | No |
| Cron schedule (pg_cron) | created by migrations in `supabase/migrations/` | **Yes** | No |
| App code, `vercel.json`, `supabase/config.toml` | GitHub `xaviercabrerau/taskflow-kanban-prototype`, branch `main` | **Yes** | Mirror the repo |
| Domain / DNS (`task.conto.ec`) | Vercel domain settings + DNS registrar | No | Record the DNS values |

**Consequence:** a full recovery is *schema from git + data from a dump + secrets
re-entered*. There is no "restore the whole box" step, because there is no box.

### 1.1 Two separate cron systems — do not confuse them

* **Vercel Cron** — exactly **one** job, defined in `vercel.json`:
  `/api/cron/alert-check` on `0 8 * * *` (daily, 08:00 UTC). It is the alerting
  job, not a data job. It is restored automatically by deploying the repo.
* **pg_cron inside Postgres** — 7 monitored jobs (`taskflow_check_due_soon_tasks`,
  `taskflow_execute_due_date_automations`, `taskflow_execute_sla_automations`,
  `taskflow_execute_recurring_tasks`, `purge-expired-audit-logs`,
  `record-daily-metrics-snapshots`, `taskflow_resolve_crm_sync_responses`).
  These are created by `cron.schedule(...)` calls inside the migration files, so
  `supabase db push` recreates them. The canonical list the monitoring endpoints
  compare against is `src/lib/cron-jobs.ts` (`MONITORED_JOBS`).

---

## 2. Prerequisites

```bash
# CLIs (versions verified locally 2026-09-09)
supabase --version        # 2.114.0
vercel --version
pg_dump --version         # must be >= the Postgres major version of the
                          # Supabase instance (supabase/config.toml: major_version 15)
psql --version
```

Access you need (a person, not a script, must hold these):

* Supabase dashboard access to project `txdyijyswpsalqnwfopc`, plus the **database
  password** (Dashboard → Project Settings → Database).
* Vercel access to project `taskflow-kanban-prototype`
  (projectId `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`, orgId `team_LUyGoTDapYDMjHCRVzQaFiaX`).
* GitHub write access to `xaviercabrerau/taskflow-kanban-prototype`.

The repo is already linked to Vercel — `.vercel/project.json` holds the IDs above.
Link the Supabase CLI once per machine:

```bash
cd /path/to/taskflow-kanban-prototype
supabase link --project-ref txdyijyswpsalqnwfopc
```

**Never commit dump files, `.env*.local`, or anything containing a key.** Keep
backups encrypted and off the repo.

---

## 3. Backup procedures

### 3.1 Database — managed backups (what Supabase already does)

Supabase takes automated backups for you. **Before relying on this, open
Dashboard → Database → Backups and write down what this project's plan actually
provides** (retention window, and whether Point-in-Time Recovery is enabled — PITR
is a paid add-on and is *not* on by default). Do not assume a retention period
that has not been checked.

Managed backups live in the same Supabase account. They protect against data
corruption; they do **not** protect against losing the account. That is what
section 3.2 is for.

### 3.2 Database — your own dump (run this; it is the migration-safe copy)

Two dumps, because they restore differently:

```bash
mkdir -p ~/taskflow-backups/$(date +%Y%m%d)
cd ~/taskflow-backups/$(date +%Y%m%d)

# 1. Data only — public schema. This is what you replay onto a rebuilt schema.
supabase db dump --linked --data-only -f data-public.sql

# 2. Auth data — users, identities, sessions. Needed so people can still log in.
supabase db dump --linked --data-only --schema auth -f data-auth.sql

# 3. Full logical dump (schema + data), as a belt-and-braces archive.
#    Copy the exact connection string from
#    Dashboard -> Project Settings -> Database -> Connection string (URI).
#    Do not paste the password into any file that gets committed.
read -rs -p "Postgres connection URI: " PG_URI; echo
pg_dump "$PG_URI" --format=custom --no-owner --no-privileges -f full.dump
unset PG_URI
```

Notes that matter:

* `--no-owner --no-privileges` is deliberate: Supabase-managed roles
  (`supabase_admin`, `authenticator`, …) will not exist identically in another
  project, and without these flags the restore fails on `ALTER ... OWNER TO`.
* `full.dump` is the archive. It is **not** the preferred restore path — see 6.2.
  Rebuilding the schema from the 114 migrations is preferred because that is the
  project's rule (schema changes only ever come from versioned migration files),
  and it produces a schema identical to the one in code.
* Encrypt before storing anywhere shared:
  `gpg --symmetric --cipher-algo AES256 full.dump` (produces `full.dump.gpg`).

### 3.3 Storage bucket `task-attachments`

There is one private bucket, `task-attachments`
(`supabase/migrations/20260808150943_m29_task_attachments_storage_bucket_and_rls.sql`),
with object paths shaped `{tenant_id}/{task_id}/{filename}`.

The Supabase CLI storage commands are still flagged experimental, so check the
flags on your installed version before trusting an unattended run:

```bash
supabase storage --help          # confirm the subcommands exist on your version
supabase storage ls ss:///task-attachments --experimental
supabase storage cp -r ss:///task-attachments ./storage-backup --experimental
```

If that command is unavailable or fails, fall back to the Storage REST API with
the service-role key (read it from your local `.env.local` or from
Vercel — **never** write the value into this or any other document):

```bash
# SUPABASE_SERVICE_ROLE_KEY must be exported in the shell, not hardcoded.
curl -s -X POST \
  "https://txdyijyswpsalqnwfopc.supabase.co/storage/v1/object/list/task-attachments" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"","limit":1000}'

# then, per object path returned:
curl -s -o "./storage-backup/${OBJECT_PATH}" \
  "https://txdyijyswpsalqnwfopc.supabase.co/storage/v1/object/task-attachments/${OBJECT_PATH}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

`list` returns one directory level at a time, so recurse: tenant ids → task ids →
files. **This is the least-exercised procedure in this document — run it once as a
drill before you need it.**

### 3.4 Environment variables

The authoritative *list of names* is `.env.example` (kept accurate; it was pruned
in the 2026-09-03 audit to only the variables the code actually reads). The
authoritative *values* are in Vercel and in the source services.

```bash
# See which names are set in each environment (prints names, not values).
vercel env ls production
vercel env ls preview
vercel env ls development

# Pull production values into a local file. This file contains live secrets:
# it is gitignored, keep it off shared storage, delete it when done.
vercel env pull .env.production.local --environment=production
```

For a real disaster-recovery kit you want, per variable, *where to regenerate it*
rather than the value itself:

| Variable | Re-obtain from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` (dev scripts only) | same as above |
| `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` | Resend dashboard → API Keys / verified domain |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Upstash console, or the Vercel Marketplace "Upstash for Redis" integration |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Project → Client Keys (DSN) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Google Cloud Console → APIs & Services → Credentials |
| `CRON_SECRET`, `INTERNAL_NOTIFY_SECRET`, `JWT_SECRET` | Regenerate: `openssl rand -base64 32` (see 6.3 for the side effects) |
| `ALERT_WEBHOOK_URL` | Slack/Discord incoming-webhook settings |
| `NEXT_PUBLIC_APP_URL` | Set to the deployment's own URL (`https://task.conto.ec` today) |

### 3.5 Code, Vercel and DNS configuration

```bash
# Repo mirror (schema, cron config, everything in git)
git clone --mirror https://github.com/xaviercabrerau/taskflow-kanban-prototype.git

# Record the Vercel-side configuration that is NOT in the repo
vercel project ls
vercel domains ls
vercel dns ls conto.ec       # if the DNS zone is hosted at Vercel
```

Write down, by hand, whatever the DNS registrar shows for `task.conto.ec` (record
type, value, TTL). That mapping exists in no file in this repo.

---

## 4. Verify a backup (do this, or you do not have a backup)

```bash
# 1. The dump is a real custom-format archive and lists a plausible schema
pg_restore --list full.dump | head -40
pg_restore --list full.dump | grep -c "TABLE DATA"     # expect dozens, not 0

# 2. The data-only dumps are non-trivial
wc -c data-public.sql data-auth.sql
grep -c "^COPY public\." data-public.sql               # expect one per populated table

# 3. Spot-check that core tables are present
pg_restore --list full.dump | grep -E "TABLE DATA public (tasks|boards|organizations|profiles)$"
```

Core tables to expect in a healthy dump: `organizations`, `organization_members`,
`profiles`, `workspaces`, `boards`, `board_columns`, `tasks`, `task_assignees`,
`comments`, `attachments`, `roles`, `role_assignments`, `role_permissions`,
`permissions`, `audit_log`, `notifications`, `automation_rules`.

---

## 5. Recovery objectives

These are the realistic numbers for this architecture, not aspirational SLAs.

| Scenario | RTO (time to restore) | RPO (data you can lose) |
|---|---|---|
| Bad deploy / app-level regression | ~5 min (`vercel rollback`, or redeploy the previous commit) | 0 |
| Accidental data deletion, DB intact | 30–60 min (restore rows from a dump into the live DB) | Since last dump / last managed backup |
| Supabase project lost or corrupted | 2–4 h (rebuild project, push 114 migrations, load data, re-point env vars) | Since last dump / last managed backup |
| Vercel project lost | 30–60 min (re-import repo, re-enter env vars, re-point DNS) + DNS propagation | 0 (all state is in Supabase) |
| Account migration (planned) | Half a day, see [`MIGRACION.md`](../MIGRACION.md) | 0 if done with a maintenance window |

RPO is entirely a function of **how often section 3.2 is actually run**. If nobody
runs it, RPO is whatever the Supabase plan's managed backup gives you — go check
which that is (section 3.1).

---

## 6. Restore procedures

### 6.1 Bad deploy — roll the app back

Nothing to restore; the database is untouched.

```bash
vercel rollback                       # interactive: pick the previous deployment
# or redeploy a known-good commit
git checkout <good-sha> && vercel deploy --prod
curl -s https://task.conto.ec/api/health
```

### 6.2 Rebuild the database into a (new) Supabase project

This is both the disaster-recovery path and the database half of a migration.

```bash
# --- 1. Create the target project in the Supabase dashboard, note its ref. ---
NEW_REF=<new-project-ref>

# --- 2. Point the CLI at it and rebuild the schema from the 114 migrations. ---
supabase link --project-ref "$NEW_REF"
supabase db push          # applies supabase/migrations/*.sql in filename order
                          # this also recreates pg_cron/pg_net extensions,
                          # the 7 pg_cron jobs, RLS policies and get_cron_health()

# --- 3. Sanity-check the schema landed. ---
supabase migration list   # local vs remote must match: 114 applied

# --- 4. Load the data. Auth first: public rows reference auth.users(id). ---
read -rs -p "New project Postgres URI: " NEW_URI; echo
psql "$NEW_URI" -v ON_ERROR_STOP=1 -f data-auth.sql
psql "$NEW_URI" -v ON_ERROR_STOP=1 -f data-public.sql
unset NEW_URI
```

Things that will bite you here, in the order they usually do:

1. **Order matters.** `public.profiles.id` and most tenant rows are foreign-keyed
   to `auth.users(id)`. Load `data-auth.sql` before `data-public.sql` or every
   insert fails on a foreign-key violation.
2. **`data-public.sql` inserts into tables that have RLS.** `psql` connects as the
   Postgres superuser role, which bypasses RLS, so this works — but if you route
   the load through PostgREST or a non-superuser role instead, most rows will be
   silently rejected. Use `psql` with the direct connection string.
3. **The `auth` schema must be the same shape.** Restoring `auth` data across very
   different Supabase Auth versions can fail. If `data-auth.sql` will not load,
   the fallback is to recreate users via the Admin API and force a password reset
   — logins are lost, data is not.
4. **`supabase db push` on a project that is not empty** will try to apply
   migrations that were already applied. Push into a *fresh* project.
5. **pg_cron job ownership.** After the push, confirm the jobs exist:
   `psql "$NEW_URI" -c "select jobname, schedule, active from cron.job order by jobname;"`
   Expect the 7 names listed in section 1.1.

Then restore storage objects by uploading `./storage-backup` back into a
`task-attachments` bucket on the new project, preserving the
`{tenant_id}/{task_id}/{filename}` paths (the bucket itself is created by
migration `20260808150943`, so it already exists after `db push`).

### 6.3 Point the app at the restored database

```bash
# Update the Supabase-related variables in Vercel for every environment that needs it.
vercel env rm  NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_URL production      # paste the new project URL
vercel env rm  NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env rm  SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production

# Env vars are baked in at build time -> a redeploy is required, not just a restart.
vercel deploy --prod
```

Also update `supabase/config.toml` (`project_id = "<new-ref>"`) and commit it, so
the next person's `supabase link` points at the right project.

Two secrets have side effects when rotated:

* **`INTERNAL_NOTIFY_SECRET`** — Postgres triggers call `/api/internal/notify-event`
  and `/api/internal/sync-calendar-event` through `pg_net` carrying this secret.
  The value is stored **inside the database** as well as in Vercel. If you rotate
  it in Vercel only, notifications silently stop. Grep the migrations for how it
  is stored and update both sides.
* **`CRON_SECRET`** — Vercel Cron sends it automatically once it is set as an env
  var, but any external uptime monitor calling
  `/api/cron/alert-check?secret=...` has the old value hardcoded in its URL and
  must be updated by hand.

### 6.4 Verify the restore

```bash
# App + Supabase connectivity. Expect {"status":"ok","checks":{"supabase":{"ok":true,...}}}
curl -s https://task.conto.ec/api/health

# pg_cron health. Expect {"status":"ok","jobs":[...7 entries...]}
# A freshly restored DB legitimately reports "degraded" until each job has run
# once (hourly jobs: within the hour; daily jobs: 03:00 and 03:10 UTC).
curl -s https://task.conto.ec/api/health/cron

# The alerting cron endpoint, exercised by hand (CRON_SECRET exported locally):
curl -s -H "Authorization: Bearer ${CRON_SECRET}" \
  https://task.conto.ec/api/cron/alert-check
```

Then, in the browser: log in, open the board at `/`, open a task with an
attachment (checks Storage + signed URLs), and open `/admin/usuarios` as an owner
(checks RBAC and `role_assignments`, which is a *separate* system from
`organization_members.org_role`).

Finally, from a clean checkout:

```bash
npm ci
npm test          # 15 suites, 215 tests, all passing as of 2026-09-09
npx tsc --noEmit
npm run lint
```

---

## 7. Disaster scenarios

### 7.1 Accidental mass deletion, database otherwise healthy

1. Stop the bleeding: if a runaway script is deleting, revoke its key
   (`SUPABASE_SERVICE_ROLE_KEY` rotation) before anything else.
2. Check whether the rows are recoverable from `audit_log` (retention is enforced
   by the `purge-expired-audit-logs` job — check the org's configured retention
   before assuming the history is there).
3. If PITR is enabled on this project's plan, restore to just before the deletion
   via Dashboard → Database → Backups. If it is not, restore the affected tables
   from the most recent `data-public.sql` into a **scratch** project, extract only
   the missing rows, and insert those into production. Never replay a whole
   data-only dump onto a live database — it will collide on primary keys.

### 7.2 Supabase project lost / account inaccessible

Follow 6.2 → 6.3 → 6.4. Time is dominated by re-entering environment variables and
by DNS, not by the data load.

### 7.3 Vercel project lost / account inaccessible

The app is stateless. Import the GitHub repo into a new Vercel project, set every
variable from `.env.example` (values per the table in 3.4), add the `task.conto.ec`
domain, update the DNS record at the registrar, and deploy. `vercel.json` restores
the single daily cron automatically. Update `GOOGLE_OAUTH_REDIRECT_URI` and the
authorised redirect URI in Google Cloud Console if the domain changes.

### 7.4 Credential compromise

Rotate in this order, verifying after each: `SUPABASE_SERVICE_ROLE_KEY` (Supabase
dashboard) → `RESEND_API_KEY` → Upstash token → `CRON_SECRET` →
`INTERNAL_NOTIFY_SECRET` (both in Vercel *and* in the database, see 6.3) →
`JWT_SECRET` (invalidates in-flight Google OAuth `state` values; users mid-connect
must retry) → Google OAuth client secret. Redeploy after each batch, because env
vars are read at build time. Then review `audit_log` for the exposure window.

---

## 8. Known gaps — be honest about these

* **No automated off-account backup exists today.** Section 3.2 is a manual
  procedure. Until someone schedules it, the only backups are Supabase's managed
  ones, which live in the same account that a disaster might take away.
* **Storage backup (3.3) has not been drilled.** Treat the first real run as an
  exercise, not as a recovery.
* **No staging Supabase project**, so restore drills either run against a
  throwaway project or not at all.
* **PITR status unverified.** Nobody has recorded whether this project's plan
  includes it. Check and note it here.
* **DNS values are not recorded anywhere in the repo.**

---

## 9. Test schedule

| Cadence | Test |
|---|---|
| Monthly | Run section 3.2, then verify with section 4. Store the dump encrypted, off-account. |
| Quarterly | Full restore drill: 6.2 into a throwaway Supabase project, then section 4's checks against it. Record how long it actually took. |
| Quarterly | Confirm `vercel env ls production` still matches `.env.example`. |
| Annually | Review this document against reality; update the gaps in section 8. |

---

## 10. References

* `.env.example` — authoritative list of environment variable names
* `supabase/migrations/` — 114 migrations; the database schema, in git
* `supabase/config.toml` — links the repo to Supabase project `txdyijyswpsalqnwfopc`
* `vercel.json` — the single Vercel cron (`/api/cron/alert-check`, `0 8 * * *`)
* `src/lib/cron-jobs.ts` — the 7 pg_cron jobs the health endpoints monitor
* `ops/3-runbooks.md` — incident runbooks
* `ops/5-troubleshooting-guide.md` — symptom-first troubleshooting
* [`MIGRACION.md`](../MIGRACION.md) — moving the project to different accounts

---

**Last verified against the codebase:** 2026-09-09
