# Sentry Error Tracking Setup

> **Status: IMPLEMENTED (minimal configuration).** Verified against the code on
> 2026-09-10. `@sentry/nextjs` ^10.70.0 is a real dependency and the SDK is wired
> into the app. What is wired is deliberately small — read
> [What is actually configured](#what-is-actually-configured) before assuming any
> feature described elsewhere is on.
>
> Earlier revisions of this document described a `sentry.config.js` file,
> `SENTRY_ENABLED` / `SENTRY_TRACE_SAMPLE_RATE` / `SENTRY_REPLAYS_*` environment
> variables, session replay, source-map upload and a `pages/` router integration.
> **None of that exists in this repository.** It has been removed from this guide.

---

## What is actually configured

Five files, all at the repository root:

| File | Runtime | What it does |
|---|---|---|
| `instrumentation.ts` | Server + Edge | Next.js `register()` hook. Imports `sentry.server.config` when `NEXT_RUNTIME === "nodejs"`, `sentry.edge.config` when `"edge"`. Also exports `onRequestError = Sentry.captureRequestError`, which reports uncaught errors from Server Components, Route Handlers and Server Actions. |
| `sentry.server.config.ts` | Node.js | `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })` |
| `sentry.edge.config.ts` | Edge | Same init, same `SENTRY_DSN`. |
| `sentry.client.config.ts` | Browser | `Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 })` |
| `instrumentation-client.ts` | Browser | Client instrumentation entry point. **Defers** loading the client SDK until the first real user interaction (`click`, `keydown`, `scroll`, `pointermove`) or 5s after first paint, whichever comes first, via a dynamic `import()` so the ~143 KB gzip SDK stays out of the initial chunk. |

That is the entire integration. There is no `withSentryConfig` wrapper in
`next.config.ts`, no source-map upload, no session replay, no release tracking,
no custom `beforeSend`, and no PII scrubbing hook — see
[`PII_SCRUBBING.md`](./PII_SCRUBBING.md).

### Environment variables actually read

Only two, and neither is required for the app to run:

| Variable | Read by | If unset |
|---|---|---|
| `SENTRY_DSN` | `sentry.server.config.ts`, `sentry.edge.config.ts` | `dsn: undefined` → `Sentry.init` silently no-ops. Nothing breaks. |
| `NEXT_PUBLIC_SENTRY_DSN` | `sentry.client.config.ts` | Same silent no-op on the browser side. |

`NEXT_RUNTIME` is read by `instrumentation.ts` but is set by Next.js itself, not
by you.

> Never commit a DSN value to this repository or paste one into documentation.
> Set the variables in the Vercel project settings and in your local `.env.local`.

### Explicit `captureException` calls in application code

Sentry is called by hand in exactly one place: the top-level `catch` in
`src/app/api/mcp/route.ts`, so an unhandled crash in the JSON-RPC handler is
reported before the request fails. Everything else relies on `onRequestError`.

---

## Accepted tradeoffs (do not "fix" these without deciding again)

1. **Deferred client SDK.** An error that happens *before* the first interaction
   or the 5s fallback — a crash during initial hydration, for example — is never
   reported. This was a deliberate performance decision (2026-09-04); the
   reasoning is written in `instrumentation-client.ts`.
2. **`tracesSampleRate: 0.1` everywhere.** 10% of transactions, in every
   environment. There is no per-environment override, because there is no
   environment-switching code.
3. **No source maps uploaded.** Stack traces from production will point at
   minified bundle positions. Adding source-map upload means adding
   `withSentryConfig` to `next.config.ts` plus a `SENTRY_AUTH_TOKEN` — currently
   neither exists.

---

## Setting up a Sentry project (for a fresh account)

1. Create an account at <https://sentry.io/> and a new project with platform
   **Next.js**.
2. Copy the project's DSN. It looks like
   `https://<key>@<org>.ingest.sentry.io/<projectId>` — treat it as a secret and
   keep it out of git.
3. Set both variables in Vercel → Project → Settings → Environment Variables:
   - `SENTRY_DSN` (server/edge)
   - `NEXT_PUBLIC_SENTRY_DSN` (browser — this one *is* shipped to the client, which
     is normal for Sentry DSNs)
4. Redeploy. No code change is needed; the config files already read those names.

> **Migration note:** Sentry is optional for this project — the app runs fine
> with both DSNs unset. If TaskFlow moves to another account, create a new Sentry
> project and replace both variables; nothing else in the repo is tied to the old
> project. See [`MIGRACION.md`](../MIGRACION.md).

---

## Verifying it works

There is no automated test for the Sentry wiring (`npm test` does not cover it).
To check manually against a deployment:

1. Confirm the variables are present in the Vercel environment.
2. Trigger a server-side error on a route handler and confirm the issue appears
   in the Sentry project within a minute or two (`onRequestError` path).
3. For the browser path, remember the SDK only loads after an interaction — click
   somewhere first, then trigger the error.

If nothing arrives, check in this order: DSN variable actually set for the right
environment → deployment actually redeployed after setting it → ad blocker on the
client (blocks `ingest.sentry.io`) → the deferred-load tradeoff above.

---

## If you want more than this

These are *not* implemented. Each is real work, not a config toggle:

- Source-map upload (`withSentryConfig` + `SENTRY_AUTH_TOKEN`)
- Release/commit tracking (`VERCEL_GIT_COMMIT_SHA` is available in the app but is
  not currently passed to `Sentry.init`)
- Session replay
- `beforeSend` PII scrubbing — see [`PII_SCRUBBING.md`](./PII_SCRUBBING.md)
- Per-environment sample rates
- Alert rules and Slack/email routing (configured in the Sentry UI, not in code)

---

**Related:** [`OBSERVABILITY.md`](../OBSERVABILITY.md) ·
[`PII_SCRUBBING.md`](./PII_SCRUBBING.md) · [`DATADOG_SETUP.md`](./DATADOG_SETUP.md)
(not implemented) · [`MIGRACION.md`](../MIGRACION.md)

**Last verified against the code:** 2026-09-10
