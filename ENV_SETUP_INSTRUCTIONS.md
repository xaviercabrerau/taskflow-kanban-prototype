# TaskFlow — Environment Variables: where each value comes from

> **What this document covers:** for every environment variable the code
> actually reads, *where to obtain its value* and how to verify it.
> **Where to go for anything else:**
> • Canonical list of variables with inline comments → [`.env.example`](./.env.example)
> • Secure handling, rotation and revocation policy → [`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md)
> • Which variables must be set before deploying → [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md)
> • Deploying → [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
> • Recreating all of this in different accounts → [`MIGRACION.md`](./MIGRACION.md)

**Last verified:** 2026-09-09 against `process.env.*` usage in the codebase.

**This document never contains secret values — only variable names and the
place each value is obtained from.** Real values live in Vercel's environment
variables and in your local, git-ignored `.env.local`.

Set up locally with:

```bash
cp .env.example .env.local   # then fill in the values below
```

In production, set them in *Vercel → Settings → Environment Variables* for the
Production, Preview and Development environments.

---

## 1. Supabase — required

**Source:** [app.supabase.com](https://app.supabase.com) → your project →
*Project Settings → API*.

| Variable | Which field |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon / public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key — secret |

The current project ref is `txdyijyswpsalqnwfopc`.
*Migration note:* it changes when moving to another Supabase account — see
[`MIGRACION.md`](./MIGRACION.md).

> The **service role key bypasses every RLS policy**. It is server-side only:
> never put it in client code, in the repository, or in a document. In the app
> it is used by a handful of flows that must bypass RLS deliberately
> (`src/lib/notifications/notify.ts`, `src/lib/google/client.ts`,
> `src/lib/ai/client.ts`, `src/lib/github/client.ts`, and admin operations on
> other users' `profiles` rows).

`SUPABASE_URL` and `SUPABASE_ANON_KEY` (same values, without the
`NEXT_PUBLIC_` prefix) are read **only** by the local helper scripts in
`scripts/`, not by the app.

**Verify:**
```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/permissions?select=id&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

---

## 2. Application URL

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_APP_URL` | The public base URL. Production: `https://task.conto.ec`. Local: `http://localhost:3000` |

Used to build absolute links in outgoing emails (`src/lib/emails/utils.ts`).
Falls back to `http://localhost:3000` when unset — which silently produces
broken links in production emails, so set it.

---

## 3. Resend — transactional email

**Source:** [resend.com](https://resend.com) → *API Keys*.

| Variable | Where it comes from |
|---|---|
| `RESEND_API_KEY` | Resend → API Keys → Create API Key |
| `NOTIFICATION_FROM_EMAIL` | A sender address on a domain **verified in Resend** |

The sender domain must be verified in Resend (*Domains* → add the DNS records
it gives you). Without verification, no email is delivered.

---

## 4. Upstash Redis — rate limiting and cache

**Source:** [upstash.com](https://upstash.com) → create a Redis database → the
**REST** tab.

| Variable | Where it comes from |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash → database → REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → database → REST token |
| `KV_REST_API_URL` | Injected automatically by the Vercel Marketplace "Upstash for Redis" integration |
| `KV_REST_API_TOKEN` | Same integration |

`src/lib/rate-limit.ts` accepts **either pair** — the `KV_REST_API_*` names are
legacy `@vercel/kv` naming that the Vercel integration provisions for you. You
need one pair, not both. With neither, rate limiting degrades to a weak
in-memory limiter that does not work across serverless instances.

---

## 5. Application secrets — generated, not obtained

Generate each with:

```bash
openssl rand -base64 32
```

| Variable | What it protects |
|---|---|
| `CRON_SECRET` | Authenticates the Vercel cron against `/api/cron/alert-check` (sent as `Authorization: Bearer <value>`, or `?secret=` for monitors that cannot send headers) |
| `INTERNAL_NOTIFY_SECRET` | Protects `/api/internal/notify-event` and `/api/internal/sync-calendar-event`, called by Postgres triggers via `pg_net` |
| `JWT_SECRET` | Signs the Google OAuth `state` parameter and the tokens of the public REST API `/api/v1/*` |

> **`JWT_SECRET` is not disposable.** Changing it invalidates every API key
> users have already issued (`/admin/api-keys` and the MCP integration); they
> would all have to be reissued.

---

## 6. Google OAuth — optional (Calendar, Drive, Gmail)

**Source:** [Google Cloud Console](https://console.cloud.google.com) → *APIs &
Services → Credentials*. Create an **OAuth 2.0 Client ID** of type *Web
application*, and enable the Calendar, Drive and Gmail APIs.

| Variable | Where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Must match an **Authorized redirect URI** registered in Google Cloud, exactly. Production: `https://task.conto.ec/api/integrations/google/callback`. Local: `http://localhost:3000/api/integrations/google/callback` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same client ID, exposed to the browser for the Drive Picker |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | *Credentials → Create credentials → API key*, restricted by HTTP referrer |

The two `NEXT_PUBLIC_*` values ship in the client bundle by design: OAuth
client IDs are public, and the Picker key is protected by referrer
restrictions, not by secrecy. `GOOGLE_CLIENT_SECRET` is **not** public.

*Migration note:* the redirect URI is tied to the current domain. On a domain
change it must be updated both here and in Google Cloud — see
[`MIGRACION.md`](./MIGRACION.md).

---

## 7. Sentry — optional error tracking

**Source:** [sentry.io](https://sentry.io) → create a Next.js project →
*Settings → Client Keys (DSN)*.

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Client DSN |
| `SENTRY_DSN` | Same DSN, server side |

The app is instrumented (`@sentry/nextjs`, `instrumentation.ts`,
`sentry.*.config.ts`) but currently runs **without a DSN configured**: without
these, everything works, just with no error tracking.

---

## 8. Alert webhook — optional

| Variable | Where it comes from |
|---|---|
| `ALERT_WEBHOOK_URL` | An incoming webhook URL from Slack (*Apps → Incoming Webhooks*), Discord, or an equivalent service |

`/api/cron/alert-check` posts to it when a health check fails. Unset, the cron
still runs and still reports through its HTTP response; it just does not notify
anywhere.

---

## 9. Platform-injected — do not set by hand

`NODE_ENV` and `VERCEL_GIT_COMMIT_SHA` are provided by Next.js and Vercel.

---

## Verification

```bash
# Locally: confirm each name is present in .env.local (prints names, not values)
grep -oE '^[A-Z_]+' .env.local | sort

# In Vercel: list configured names per environment
vercel env ls
```

> `scripts/validate-environment.sh` is **not** a reliable check: it dates from
> the same 2026-08-18 boilerplate as the older versions of these documents and
> validates variables this project never used (Slack, PagerDuty, Twilio,
> Datadog, Gmail service accounts, `TASKFLOW_URL`, `API_BASE_URL`). Use
> [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md) instead until that script is
> rewritten.

## Variables that are *not* used by this project

Older revisions of this file documented `GMAIL_SERVICE_ACCOUNT_JSON`,
`GMAIL_SENDER_EMAIL`, `GOOGLE_CLOUD_PROJECT_ID`, `STAFF_API_KEY`, `REDIS_URL`,
`LOG_LEVEL`, `RATE_LIMIT_MAX` and `NEXT_PUBLIC_VERCEL_URL`. **None of them are
read anywhere in the codebase.** They belonged to a BullMQ/Gmail notification
design that was never built — email goes out through Resend, and rate limiting
through Upstash. Do not configure them.
