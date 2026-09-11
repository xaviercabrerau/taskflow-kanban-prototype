# TaskFlow — Initial Environment Setup Plan

> **What this document covers:** standing up a **new** TaskFlow environment
> from zero — a fresh Supabase project, a fresh Vercel project, and the
> auxiliary services — in the order that avoids rework. Roughly 2–3 hours.
> **Where to go for anything else:**
> • Routine deployment to an environment that already exists →
> [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
> • Moving the **existing** installation (with its data and users) to other
> accounts → [`MIGRACION.md`](./MIGRACION.md) — that document supersedes this
> one for migrations, because it also covers backups, user UUIDs and rollback
> • Per-item configuration tick-list → [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md)
> • Where each credential comes from → [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md)

**Last verified:** 2026-09-09.

Use this for a new staging environment, a demo instance, or a from-scratch
install. **If you are moving the live installation, use `MIGRACION.md`
instead** — it is the same ground plus data migration and a reversal plan.

---

## Phase 1 — Repository and toolchain (15 min)

```bash
git clone https://github.com/xaviercabrerau/taskflow-kanban-prototype.git
cd taskflow-kanban-prototype
npm install
cp .env.example .env.local
```

- [ ] Node.js ≥ 20.9.0 (required by Next.js 16)
- [ ] `npm install` completes — it fetches `xlsx` from the SheetJS CDN
      (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), not from npm.
      That is deliberate (the npm build carries two unpatched HIGH
      vulnerabilities) and the machine must be able to reach that host.
- [ ] Optional CLIs: `supabase`, `vercel`

---

## Phase 2 — Supabase (30 min)

1. [ ] Create the project; note its **project ref** and pick a region close to
       your users.
2. [ ] From *Project Settings → API*, collect `NEXT_PUBLIC_SUPABASE_URL`,
       `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` into
       `.env.local` (never into a tracked file).
3. [ ] Apply the schema. It is fully versioned — **114 migration files** in
       `supabase/migrations/` as of 2026-09-09 — and is the only source of
       truth for the schema:
       ```bash
       supabase link --project-ref <your-project-ref>
       supabase db push
       ```
4. [ ] Verify tables and RLS policies exist:
       ```sql
       select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
       select tablename, policyname from pg_policies where schemaname='public' order by 1;
       ```
5. [ ] Set the Auth site/redirect URLs to the environment's public URL.

> **Rule:** every future schema change is a new versioned file in
> `supabase/migrations/`. Never raw SQL against the remote project.

---

## Phase 3 — Auxiliary services (30 min)

Do these before the first deploy so the environment comes up complete.

- [ ] **Resend** — create the API key, **verify the sender domain** (its DNS
      records), set `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL`. Without a
      verified domain no email is delivered.
- [ ] **Upstash Redis** — create a database; set either
      `UPSTASH_REDIS_REST_URL`/`_TOKEN` or, via the Vercel Marketplace
      integration, `KV_REST_API_URL`/`_TOKEN`. Either pair works.
- [ ] **Application secrets** — generate three distinct values with
      `openssl rand -base64 32`: `CRON_SECRET`, `INTERNAL_NOTIFY_SECRET`,
      `JWT_SECRET`.
- [ ] **Sentry (optional)** — create a Next.js project, set `SENTRY_DSN` and
      `NEXT_PUBLIC_SENTRY_DSN`. The app is instrumented but runs fine without.
- [ ] **Google Cloud (optional)** — only for the Drive/Calendar/Gmail
      integrations. Create the OAuth client and Picker API key, and register
      the redirect URI `https://<your-domain>/api/integrations/google/callback`
      **exactly** as you will set `GOOGLE_OAUTH_REDIRECT_URI`.
- [ ] **Alert webhook (optional)** — `ALERT_WEBHOOK_URL`, a Slack/Discord
      incoming webhook the alert cron posts failures to.

Full sourcing instructions: [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md).

---

## Phase 4 — Local verification (20 min)

```bash
npm run dev           # http://localhost:3000
npx tsc --noEmit
npm run lint
npm test              # expected: 15 suites, 215 tests passing
npm run build
```

- [ ] The board loads and you can sign in against the new Supabase project.
- [ ] `curl -s http://localhost:3000/api/health` returns `"status":"ok"`.

---

## Phase 5 — Vercel (30 min)

1. [ ] *Add New → Project*, import the repository.
2. [ ] Framework **Next.js**; build `npm run build`, install `npm install`.
       **Confirm Root Directory is the repository root** — a wrong value here
       once caused 10+ days of silently failing production deployments.
3. [ ] Load **every** environment variable from Phases 2–3 into Production,
       Preview and Development *before* the first deploy.
4. [ ] Deploy:
       ```bash
       git push origin main     # Vercel's GitHub integration builds from main
       # or, from your machine:
       vercel deploy --prod
       ```
5. [ ] Assign the domain in *Settings → Domains* and update DNS.
6. [ ] Confirm the single cron registered from `vercel.json` appears under
       *Settings → Cron Jobs*:
       ```json
       { "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
       ```
       (daily, 08:00 UTC — there is exactly one).
7. [ ] If Google integrations are enabled, update the authorized redirect URI in
       Google Cloud to the real domain.

---

## Phase 6 — Acceptance (30 min)

```bash
curl -s https://<your-domain>/api/health       # {"status":"ok",...}
curl -s https://<your-domain>/api/health/cron  # no stale jobs
```

- [ ] Sign in; the Kanban board at `/` loads.
- [ ] Create a task, move it between columns, comment on it.
- [ ] `/admin` opens as organization owner and lists users.
- [ ] Create a test user from `/admin/usuarios` and confirm that user **can
      create tasks** — this is what proves an RBAC role was assigned, not just
      an `org_role`. Delete the test user afterwards.
- [ ] Download the template at `/admin/importar-tareas` and import 2 rows
      (`.xlsx`/`.xls`/`.csv`, max 500 rows). Delete them afterwards.
- [ ] A notification email arrives (validates Resend end-to-end).
- [ ] If Google is enabled, connect the integration from
      `/admin/integraciones`.

> **The single most common post-setup failure:** `org_role` and RBAC are
> separate systems. `organization_members.org_role`
> (owner/admin/member/guest) gates the admin panel; the RLS policies governing
> content mutations read `role_assignments` (one row per board, `role_id` →
> `roles`). The "Contribuyente" system role is what grants
> `task.create`/`task.update`. A user with `org_role='admin'` and no
> `role_assignments` row cannot create a task.

---

## Phase 7 — Handover

- [ ] Secrets stored per [`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md) —
      Vercel environment variables and a git-ignored `.env.local`, nothing in
      the repository.
- [ ] Whoever operates the environment knows: no CI pipeline exists, so
      `tsc --noEmit`, `lint`, `test` and `build` are run manually before every
      push.
- [ ] Monitoring expectations documented — see
      [`OBSERVABILITY.md`](./OBSERVABILITY.md).

---

## Note on this document's history

Before 2026-09-09 this file was a 14-section plan for a "Notification System"
built on Gmail service accounts, Pub/Sub push webhooks, BullMQ workers and a
self-hosted Redis, quoting 72 tests and 11 environment variables. That system
was never built: notifications go through Resend, rate limiting through Upstash,
the suite is 215 tests across 15 suites, and none of `GMAIL_SERVICE_ACCOUNT_JSON`,
`GMAIL_SENDER_EMAIL`, `REDIS_URL`, `STAFF_API_KEY`, `GOOGLE_CLOUD_PROJECT_ID`,
`LOG_LEVEL`, `RATE_LIMIT_MAX` or `NEXT_PUBLIC_VERCEL_URL` is read anywhere in
the codebase.
