# Observability

This document tracks what monitoring/observability scaffolding exists in this
repo today, and what still needs a human to wire up real credentials before
any of it is actually "live."

## What's in place

### 1. Application health check — `GET /api/health`

`src/app/api/health/route.ts` does a cheap Supabase connectivity check
(`select id from permissions limit 1` via the anon client) and returns:

```json
{ "status": "ok", "checks": { "supabase": { "ok": true, "latencyMs": 42 } }, "timestamp": "..." }
```

Returns HTTP 200 when healthy, 503 if the Supabase call throws or errors.
Safe to poll from any uptime monitor (UptimeRobot, Better Uptime, a Vercel
cron, etc.) — `permissions` is a global permission catalog (not tenant data)
whose `permissions_select` RLS policy is `qual = true`, i.e. readable by
anyone including the anon role, so this probe never touches tenant-scoped
data. Tenant-scoped tables (`organizations`, `boards`, `tasks`, ...) are
deliberately not used here: their RLS calls `is_org_member()`/
`is_org_owner()`, and anon's `EXECUTE` on those functions was revoked, so an
anon read against them now throws a permission error instead of returning
an empty array — which would make this probe report "down" on every
request even when Supabase is fully healthy.

### 2. Cron job health check — `GET /api/health/cron`

`src/app/api/health/cron/route.ts` reports the health of the four active
`pg_cron` jobs (`taskflow_check_due_soon_tasks`, `taskflow_execute_due_date_automations`,
`purge-expired-audit-logs`, `record-daily-metrics-snapshots` — these are the
real `jobname` values in `cron.job`, not the names of the SQL functions they
call) by calling a `get_cron_health()` Postgres RPC and flagging any job
whose most recent run is older than its expected schedule window (2h for the
hourly jobs, 26h for the daily ones) or whose last run failed.

The `get_cron_health()` RPC (`supabase/migrations/20260810231215_cron_health_rpc.sql`,
corrected in `20260810231315_fix_cron_health_rpc_job_names.sql` after the
first version shipped with the wrong job names) has been **applied to the
live database and verified**: as of this writing all four jobs report
`succeeded` and none are stale.

**This endpoint still requires one thing a human must do:**

- **Call it with an authenticated session.** The route forwards whatever
  `Authorization: Bearer <token>` header it receives to Supabase. Without a
  signed-in user's access token, the RPC call is rejected (anon has no
  EXECUTE grant), and the endpoint returns a 503 with a hint explaining why.
  In practice this means the endpoint is meant to be called by an internal
  admin dashboard route or a scheduled job that authenticates as a
  monitoring/service account user — not hit anonymously from an external
  uptime monitor the way `/api/health` is.

We deliberately did **not** use a `SUPABASE_SERVICE_ROLE_KEY` for this. A
service-role key bypasses every RLS policy in the project; shipping one to a
Vercel serverless function just to read four rows of cron history trades a
narrow, well-scoped read for a credential that can read/write everything.
The `SECURITY DEFINER` RPC keeps the elevated privilege inside Postgres,
scoped to exactly this query.

### 3. Scheduled alerting — `GET /api/cron/alert-check`

`src/app/api/cron/alert-check/route.ts` closes the gap the two health
endpoints above left open: nobody was calling them on a schedule, and
nothing paged a human when they reported a problem. This route does both —
it runs the same two checks (`permissions` table read for app health,
`get_cron_health()` RPC for cron-job health) internally, then posts to a
chat webhook if it finds a problem.

**Auth**: instead of a Supabase user session, this route is gated by a
shared secret. It requires either:
- an `Authorization: Bearer <CRON_SECRET>` header (this is what Vercel Cron
  sends automatically once the `CRON_SECRET` env var is set — see
  [Vercel's Cron Jobs docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)), or
- (fallback, checked only when the header is absent) a `?secret=<CRON_SECRET>`
  query param — needed because several free-tier external uptime monitors
  can't send custom headers but can hit a custom URL.

Anything else (missing/wrong secret) is an immediate 401 before any
Supabase call is made.

**Cron-health RPC and the anon grant**: `get_cron_health()` was granted to
`authenticated` only (see section 2 above), which doesn't work from this
route since there's no signed-in user in a cron-triggered request. Because
this whole route is already gated by `CRON_SECRET` at the HTTP layer, we
made a deliberate tradeoff: also grant `anon` EXECUTE on `get_cron_health()`.
The data it returns (whether 4 known, non-secret job names are stale) is
low-sensitivity, and access to it is already gated one layer up by
`CRON_SECRET`. This grant lives in
`supabase/migrations/20260810235939_grant_cron_health_to_anon.sql`.

**This migration has been applied to the live database and verified**:
`get_cron_health()` now returns real data when called as `anon`, matching
the four jobs' actual status (see section 2 above — all currently healthy).

**Alerting**: if either check finds a problem, and `ALERT_WEBHOOK_URL` is
set, the route POSTs `{"text": "...", "content": "..."}` (both keys, same
message) to that URL — Slack incoming webhooks read `text`, Discord
webhooks read `content`, and each platform ignores the field it doesn't
recognize, so one payload works for either. If `ALERT_WEBHOOK_URL` is not
set, the summary is written via `console.error` instead (visible in
Vercel's function logs) and the request still succeeds. The response body
is always `{ ok: true, problems: [...], alerted: boolean, timestamp }`,
with an empty `problems` array when everything's healthy.

**Env vars a human must set** (Vercel Project Settings → Environment
Variables):

- `CRON_SECRET` — required. Generate one with `openssl rand -hex 32` and
  set it in Vercel. Without it, the route always returns 401 (it refuses to
  treat a missing `CRON_SECRET` env var as "no auth required").
- `ALERT_WEBHOOK_URL` — optional. A Slack incoming webhook URL or a Discord
  webhook URL. No alerting fires without it; problems are only logged.

**Vercel Cron config**: `vercel.json` at the repo root schedules this route
once a day at 08:00 UTC (`0 8 * * *`).

> **Critical limitation — Vercel Hobby plan cron frequency.** This project
> is on Vercel's Hobby plan, which caps Cron Jobs to **once per day**
> regardless of the schedule expression used. That means Vercel Cron alone
> cannot deliver anything close to real-time alerting on this plan — a site
> outage at 09:00 UTC will not be caught by Vercel Cron until the next
> scheduled run roughly 24 hours later. Upgrading to Vercel Pro removes this
> cap (down to once-per-minute schedules), but that's a paid-plan decision
> for a human to make, not something to do silently here.
>
> **Workaround (free, no Vercel upgrade needed)**: point a free-tier
> external uptime monitor — **UptimeRobot**, **Better Uptime**, or
> **Freshping** all offer free tiers with 5-minute check intervals — at:
>
> ```
> https://<your-domain>/api/cron/alert-check?secret=<CRON_SECRET-value>
> ```
>
> This is exactly why the query-param auth fallback exists: none of those
> three tools' free tiers support sending a custom `Authorization` header,
> but all of them support a custom monitor URL. With this in place, Vercel
> Cron provides a once-daily baseline heartbeat (useful as a backstop even
> if the external monitor's account lapses or its check silently stops),
> and the external monitor provides the actual frequent, real-time-ish
> alerting — both hitting the same endpoint, both gated by the same secret,
> at zero additional cost.

### 4. Sentry — installed and wired up

An earlier pass in this project added `@sentry/nextjs` but had to revert it:
`@sentry/nextjs@^9.0.0`'s peer dependency only went up to `next@^15.0.0-rc.0`,
and this project is on Next.js 16.3.0. Sentry has since released `10.70.0`,
whose peer range is `next: ^13.2.0 || ^14.0 || ^15.0.0-rc.0 || ^16.0.0-0` —
Next 16 support landed, confirmed with a real `npm install` (no
`--legacy-peer-deps` needed). Sentry is now actually installed, not just
scaffolded:

- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
  — the three per-runtime `Sentry.init(...)` calls, reading
  `NEXT_PUBLIC_SENTRY_DSN` (client) / `SENTRY_DSN` (server/edge). Both are
  unset-safe: `Sentry.init` no-ops when `dsn` is `undefined`, so nothing
  breaks in any environment where these aren't configured yet.
- `instrumentation.ts` — Next.js 16's `register()` hook (loads the right
  per-runtime config based on `NEXT_RUNTIME`) plus
  `onRequestError = Sentry.captureRequestError` for uncaught Server
  Component / Route Handler / Server Action errors.
- `instrumentation-client.ts` — Next.js 16's client-instrumentation entry
  point (side-effect import of `sentry.client.config.ts`).
- `src/app/api/mcp/route.ts` — the `POST` handler's existing top-level
  try/catch now calls `Sentry.captureException(error)` before falling back
  to the generic JSON-RPC internal-error response (in addition to the
  existing `console.error`, not instead of it).

**Still required — a human must do this, it can't be guessed blind**:
create a project at [sentry.io](https://sentry.io) (or self-hosted Sentry),
grab its DSN, and set `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` in every
environment (local `.env.local`, Vercel Preview, Vercel Production). Until
that DSN exists, Sentry silently captures nothing — no errors are being
reported anywhere yet, but nothing is broken either.

### 5. MCP endpoint rate limiting — `src/lib/rate-limit.ts`

`POST /api/mcp` (the JSON-RPC endpoint used by MCP clients like Claude
Desktop/Code to list/create/move tasks and add comments) previously had no
throttling at all: any holder of a valid Personal Access Token, or anyone
hitting the token-free `initialize`/`tools/list` methods, could call it as
fast as they wanted. `src/lib/rate-limit.ts` adds a shared, serverless-safe
limiter using [`@upstash/ratelimit`](https://github.com/upstash/ratelimit)
backed by Upstash Redis (an in-memory counter doesn't work reliably across
Vercel invocations/regions/cold-starts — a shared store is required).

**Default limit:** 30 requests per rolling minute, per caller. Adjust
`REQUESTS_PER_WINDOW` / `WINDOW` in `src/lib/rate-limit.ts` if a different
budget is needed.

**Key derivation:** each caller's Personal Access Token is SHA-256 hashed
(via Node's `crypto` module — the raw token is never stored or logged) and
used as the rate-limit key, so each PAT gets its own independent budget.
Requests made before a token is known (e.g. `initialize` / `tools/list`)
fall back to a key derived from the client's IP (`x-forwarded-for`, which
Vercel sets).

The check runs in `src/app/api/mcp/route.ts`'s `POST` handler before the
request body is even parsed, so the whole endpoint is covered, not just
`tools/call`. When the limit is exceeded, the endpoint returns a JSON-RPC
error (code `-32029`) with HTTP status 429.

**Fail-open behavior:** `checkRateLimit()` fails open in two distinct
cases, both resulting in the request being allowed through rather than
blocked or erroring out. First, it reads `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` from the environment — if either is missing
(true today in local dev and in production until a human completes the
step below), it logs a single `console.warn` (not on every request) and
skips enforcement entirely. Second, even once Upstash is configured, the
real `limiter.limit()` call is wrapped in a try/catch: if Upstash itself
throws (network blip, outage, DNS failure), that error is caught and
logged via `console.error`, and the request is allowed through the same
way — a transient Upstash error never propagates out of `checkRateLimit()`
to take down the whole MCP endpoint for every caller. The MCP endpoint
keeps working exactly as it did before this change in both of these
situations.

**To activate enforcement, a human needs to:**

1. In the Vercel dashboard, open this project → **Integrations** (or
   **Storage** → **Marketplace Database Providers** depending on the
   current Vercel UI) tab.
2. Search for **"Upstash"** and add the **Upstash Redis** integration
   (free tier is sufficient for this use case).
3. Select this project when prompted. Vercel/Upstash will automatically
   create a Redis database and populate `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` as environment variables on the project (all
   environments, or just Production — choose based on whether you also
   want rate limiting active in Preview deployments).
4. Redeploy (or trigger a new deployment) so the new env vars are picked
   up. No code changes are needed — `checkRateLimit()` will detect the
   vars and start enforcing the 30 req/min limit automatically.
5. For local development, copy the same two values into `.env.local` if
   you want to exercise rate limiting locally; otherwise local dev will
   continue to fail open (with the one-time warning logged to the
   console), which is fine for day-to-day work.

## What still requires a human (cannot be wired blind)

None of the following can be completed without real, externally-issued
credentials — there is nothing more to "build" here, just accounts to create
and secrets to add to environment config (Vercel project settings, `.env.local`
for local dev, etc.):

1. **A Sentry project + DSN.** The SDK is installed and wired up (section 4
   above) — only the account and DSN are missing. Until `NEXT_PUBLIC_SENTRY_DSN`/
   `SENTRY_DSN` are set, no unhandled application errors are being captured
   anywhere.
2. **A log-drain destination for Supabase/Postgres logs** (Logflare,
   Datadog, Better Stack, etc.). Supabase's own dashboard has short log
   retention; a real log drain is needed for anything beyond a few days of
   history or for alerting on Postgres-level errors (slow queries,
   connection exhaustion, RLS denials at scale) that never surface as an
   application-level exception.
3. **The scheduled caller and webhook are now built** (`/api/cron/alert-check`,
   see section 3 above) — what's left is purely account/config work a human
   must do, since none of it can be guessed blind:
   - Generate and set `CRON_SECRET` in Vercel Project Settings (see section 3).
   - Decide who gets paged, create a Slack incoming webhook or a Discord
     webhook for that channel/person, and set its URL as `ALERT_WEBHOOK_URL`
     in Vercel. Until this is set, problems are only visible in Vercel's
     function logs (`console.error`), not pushed anywhere.
   - Sign up for a free-tier external uptime monitor (UptimeRobot, Better
     Uptime, or Freshping) and point it at `/api/cron/alert-check?secret=...`
     if more-than-daily alerting is wanted — see the Hobby-plan limitation
     called out in section 3.
