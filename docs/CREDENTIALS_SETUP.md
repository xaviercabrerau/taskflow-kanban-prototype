# Credentials Setup Guide

**Last verified against the code:** 2026-09-09 (`.env.example` + every `process.env.*`
reference in `src/`).

How to obtain and configure the credentials for the external services TaskFlow actually
uses. The authoritative list of variables is `.env.example` at the repo root; this
document explains where each value comes from.

> **This file names environment variables. It never contains their values.** Real keys
> live in `.env.local` (git-ignored) and in Vercel → Project Settings → Environment
> Variables.

> **Migration note:** the accounts referenced here (Supabase project
> `txdyijyswpsalqnwfopc`, Vercel project `taskflow-kanban-prototype`, the
> `task.conto.ec` domain) belong to the current owner. To recreate all of this under a
> different GitHub/Vercel/Supabase account, follow [`MIGRACION.md`](../MIGRACION.md) —
> it lists every value that must be replaced.

> **Previous versions of this guide documented Slack, PagerDuty, Twilio, Datadog and a
> Gmail service account.** None of those are wired into this codebase — they came from a
> generic observability boilerplate (Auditoría 2026-09-03, finding 16). They have been
> removed. If one of them is ever implemented for real, add its variables to
> `.env.example` and a section here as it is wired in.

---

## Contents

1. [Supabase](#1-supabase-required)
2. [Vercel](#2-vercel-required)
3. [Resend](#3-resend-email-notifications)
4. [Upstash Redis](#4-upstash-redis-rate-limiting)
5. [Application secrets](#5-application-secrets-self-generated)
6. [Sentry](#6-sentry-optional)
7. [Google Cloud OAuth](#7-google-cloud-oauth-optional)
8. [Verification](#8-verification)
9. [Security practices](#9-security-practices)

---

## 1. Supabase (required)

Database, authentication, RLS, storage, Vault and `pg_cron`. Without it the app does not
start.

1. Go to <https://app.supabase.com> → **New Project**. Save the database password
   somewhere safe — it is needed for `pg_dump`/`pg_restore` during a migration.
2. **Project Settings → API**:
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *anon public* key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - *service_role secret* key → `SUPABASE_SERVICE_ROLE_KEY`
3. The local scripts in `scripts/` (`generate-test-users.js`,
   `generate-test-tokens.js`) read the non-prefixed duplicates `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`. The app itself does not.

**`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely.** It is server-only: never give it
a `NEXT_PUBLIC_` prefix, never import it into a client component. It is required by
`/api/admin/users`, `/api/admin/create-user`, `/api/admin/link-existing-user`,
`/api/admin/reset-password`, the notification send path and the integration clients.
Without it those endpoints return `500`; read-only endpoints keep working, which makes
the failure look intermittent.

Schema is created by re-running the 114 files in `supabase/migrations/` — never by
applying SQL by hand.

---

## 2. Vercel (required)

Hosting, deployments and the daily cron.

1. Import the GitHub repo into Vercel (project `taskflow-kanban-prototype`).
2. Add every environment variable from `.env.example` under **Project Settings →
   Environment Variables**, for the environments you deploy to.
3. Point the domain (`task.conto.ec`) at the project under **Settings → Domains**.
4. `vercel.json` registers the cron `/api/cron/alert-check` at `0 8 * * *`; Vercel picks
   it up automatically on deploy.

The repo's `.vercel/project.json` already contains `projectId` and `orgId`, so
`vercel deploy --prod` from the repo root targets the right project.

---

## 3. Resend (email notifications)

1. <https://resend.com> → **API Keys** → create a key → `RESEND_API_KEY`.
2. **Domains** → add and verify the sending domain (DKIM/SPF DNS records).
3. Set `NOTIFICATION_FROM_EMAIL` to an address on that verified domain. Sending from an
   unverified domain fails silently from the user's point of view — the failure lands in
   the `failed_jobs` table, since the send path is best-effort with no retry queue.
4. `NEXT_PUBLIC_APP_URL` must be the public base URL, because outgoing emails build
   absolute task links from it (`src/lib/emails/utils.ts`). It falls back to
   `http://localhost:3000` if unset, which produces unusable links in production.

---

## 4. Upstash Redis (rate limiting)

`src/lib/rate-limit.ts` accepts **either** naming pair:

| Source | Variables |
|---|---|
| Upstash directly (<https://upstash.com> → Create Database → REST API) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Vercel Marketplace "Upstash for Redis" integration (legacy `@vercel/kv` naming) | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |

Configure one pair. With neither, rate limiting silently degrades to a weak in-memory
limiter that does not work across serverless instances.

---

## 5. Application secrets (self-generated)

These are not obtained from a third party — generate them yourself:

```bash
openssl rand -base64 32
```

| Variable | Used by |
|---|---|
| `CRON_SECRET` | `/api/cron/alert-check`. Vercel Cron sends it as `Authorization: Bearer …`; external monitors that cannot set headers may use `?secret=`. Compared with `timingSafeEqual`. |
| `INTERNAL_NOTIFY_SECRET` | `x-internal-secret` header on `/api/internal/notify-event` and `/api/internal/sync-calendar-event`. These are called by Postgres triggers through `pg_net`, never from a browser. |
| `JWT_SECRET` | Signs and verifies the Google OAuth `state` parameter (`src/lib/google/oauth.ts`). Unrelated to Supabase Auth's own JWTs. |

`ALERT_WEBHOOK_URL` is the incoming webhook (Slack, Discord or similar) that
`/api/cron/alert-check` posts to when a health check fails. It is a destination URL, not
an account credential — the app has no Slack integration beyond posting to this URL.

Rotating `INTERNAL_NOTIFY_SECRET` requires updating both Vercel and the Postgres
triggers/settings that send it; rotate it deliberately, not casually.

---

## 6. Sentry (optional)

1. <https://sentry.io> → create a **Next.js** project.
2. **Client Keys (DSN)** → `NEXT_PUBLIC_SENTRY_DSN` (browser) and `SENTRY_DSN` (server).
3. Configuration lives in `sentry.client.config.ts`, `sentry.server.config.ts`,
   `sentry.edge.config.ts` and `instrumentation-client.ts`.

The app runs fine without a DSN; errors simply go unreported.

---

## 7. Google Cloud OAuth (optional)

Needed only for the Calendar / Drive / Gmail-send integrations.

1. <https://console.cloud.google.com> → create a project.
2. **APIs & Services → Library**: enable Google Calendar API, Google Drive API, Gmail
   API.
3. **Credentials → Create Credentials → OAuth 2.0 Client ID → Web application**.
   Authorized redirect URIs:
   - `http://localhost:3000/api/integrations/google/callback`
   - `https://task.conto.ec/api/integrations/google/callback`
4. Client ID → `GOOGLE_CLIENT_ID`; client secret → `GOOGLE_CLIENT_SECRET`; the redirect
   URI you use → `GOOGLE_OAUTH_REDIRECT_URI`.
5. For the browser-side Drive Picker, the same client ID is also needed as
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, plus a browser API key as
   `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`. Both are exposed in the client bundle by design
   — OAuth client IDs are public, and the Picker key must be restricted by HTTP referrer
   in Google Cloud Console rather than kept secret.

The OAuth flow starts at `/api/integrations/google/connect` and returns to
`/api/integrations/google/callback`; per-tenant tokens are stored in Supabase Vault, not
in environment variables.

**Inbound Gmail is not operational.** `/api/webhooks/gmail-reply` returns `501`: no
Google Workspace mailbox exists to receive replies through. See
[`NOTIFICATION_SYSTEM_DESIGN.md`](./NOTIFICATION_SYSTEM_DESIGN.md).

---

## 8. Verification

```bash
# Local
cp .env.example .env.local     # then fill in the real values
npm test                       # 15 suites, 215 tests
npm run dev
curl -s http://localhost:3000/api/health

# Production
curl -s https://task.conto.ec/api/health
curl -s https://task.conto.ec/api/health/cron
```

`/api/health` returns `{"status":"ok","checks":{"supabase":{"ok":true,...}},...}` when
the Supabase credentials are valid, and `503` with the failing check otherwise.

Quick per-service checks:

| Service | Signal it is configured |
|---|---|
| Supabase | `/api/health` is `ok`; login works |
| Resend | An action that notifies produces an email; no new `failed_jobs` row |
| Upstash | Rate-limit headers present on rate-limited routes |
| Sentry | A deliberately thrown error appears in the Sentry project |
| Google OAuth | `/admin/integraciones` completes the Google connect flow |
| Cron | `/api/health/cron` reports the `pg_cron` jobs as healthy |

---

## 9. Security practices

1. `.env.local` is git-ignored — keep it that way, and never commit real keys.
2. Documentation names variables only. If you find a real key in a doc, treat it as
   leaked and rotate it.
3. Use separate credentials per environment; never point local development at the
   production Supabase project's service-role key.
4. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS: server-only, no `NEXT_PUBLIC_` prefix,
   smallest possible number of call sites.
5. Per-tenant integration secrets belong in Supabase Vault (read only by
   `SECURITY DEFINER` accessors such as `get_crm_credential`, `get_github_token`,
   `get_ai_credential`), never in a plaintext column and never in an environment
   variable.
6. Rotate third-party keys periodically, and immediately if a key was ever pasted
   somewhere it should not have been.
7. Keep a secure out-of-band copy of the environment variables: they are not in git, so
   a lost Vercel project takes them with it.
