# TaskFlow — Credential Handling, Rotation and Revocation

> **What this document covers:** the *policy* for TaskFlow's secrets — where
> they are stored, who can see them, how they are rotated, and what to do when
> one leaks.
> **Where to go for anything else:**
> • Where each variable's value is obtained → [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md)
> • Canonical variable list → [`.env.example`](./.env.example)
> • Pre-deploy configuration checklist → [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md)
> • Deploying → [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
> • Regenerating every credential in new accounts → [`MIGRACION.md`](./MIGRACION.md)

**Last verified:** 2026-09-09.

**This document contains no secret values, and must never contain any** — only
variable names, storage locations and procedures.

---

## 1. Where secrets live

| Environment | Storage | Notes |
|---|---|---|
| Local development | `.env.local` | Git-ignored (`.gitignore` excludes every `.env*` except `.env.example`). Never commit it. |
| Vercel Production / Preview / Development | *Vercel → Settings → Environment Variables* | The only source of truth for deployed secrets. |
| Local helper scripts (`scripts/`) | `.env.local` | They read the non-prefixed `SUPABASE_URL` / `SUPABASE_ANON_KEY`. |

There is no external secret manager (Vault, AWS Secrets Manager, Doppler) in
use, and none is needed at the project's current size. Vercel's encrypted
environment variables are the store of record.

`vercel env pull` **overwrites `.env.local`** — back it up first if it holds
values that are not in Vercel.

---

## 2. Secret inventory and blast radius

Ordered by how much damage exposure would cause.

| Secret | If exposed | Rotate at |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Total compromise.** Bypasses every RLS policy: full read/write on all tenants' data. | Supabase → Project Settings → API |
| Supabase database password | Direct Postgres access. | Supabase → Project Settings → Database |
| `JWT_SECRET` | Forged public-API v1 tokens and forged Google OAuth `state`. | Self-generated (`openssl rand -base64 32`) |
| `RESEND_API_KEY` | Sending email as your verified domain (phishing). | Resend → API Keys |
| `INTERNAL_NOTIFY_SECRET` | Ability to trigger internal notification/calendar endpoints. | Self-generated |
| `CRON_SECRET` | Ability to trigger `/api/cron/alert-check` at will. | Self-generated |
| `UPSTASH_REDIS_REST_TOKEN` / `KV_REST_API_TOKEN` | Read/write on the rate-limit and cache store. | Upstash → database |
| `GOOGLE_CLIENT_SECRET` | Impersonating the OAuth client. | Google Cloud → Credentials |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Event spam into the Sentry project only. | Sentry → Client Keys |
| `ALERT_WEBHOOK_URL` | Posting messages into the alert channel. | Slack/Discord → recreate the webhook |

Public by design, **not** secrets: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (constrained by RLS),
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` (protect it with an HTTP-referrer
restriction in Google Cloud instead), `NEXT_PUBLIC_SENTRY_DSN`.

---

## 3. Rotation

There is no automated rotation. Rotate:

- **On any suspicion of exposure** — immediately, per section 4.
- **When someone with access leaves** the project.
- **On account migration** — see [`MIGRACION.md`](./MIGRACION.md), which
  regenerates everything in the destination accounts by construction.
- Otherwise, on a periodic review you can actually sustain. Pick a real
  interval and keep it; a policy nobody follows is worse than an honest
  "rotated on exposure and on personnel change".

### Procedure (rotate without downtime)

1. Create the new credential in the provider's console — **do not revoke the
   old one yet.**
2. Update the value in *Vercel → Settings → Environment Variables* for each
   environment that needs it.
3. Redeploy (environment variables are read at build/run time, so a running
   deployment keeps the old value):
   ```bash
   vercel deploy --prod
   ```
4. Verify the new credential works:
   ```bash
   curl -s https://task.conto.ec/api/health      # Supabase connectivity
   ```
   plus a functional check specific to the secret (send a notification email
   for Resend, hit a rate-limited route for Upstash, connect the integration
   for Google).
5. **Now** revoke the old credential in the provider's console.
6. Update your own `.env.local` and tell anyone else running the project
   locally.

### Two rotations with special consequences

- **`JWT_SECRET`:** rotating it invalidates **every API key users have already
  issued** (`/admin/api-keys`, and the MCP integration used by Claude
  Desktop / Claude Code). They must all be reissued. Only rotate it on a real
  exposure, and warn users first.
- **`SUPABASE_SERVICE_ROLE_KEY`:** rotating it in Supabase invalidates the old
  key instantly, so update Vercel and redeploy in the same window — flows that
  need it (notifications, admin edits to other users' profiles, Google/GitHub/AI
  clients) fail until then.

---

## 4. If a credential leaks

**Within minutes**

1. Revoke or rotate it in the provider's console — revoke first, ask questions
   later. An outage is cheaper than an open door.
2. Set the replacement in Vercel and redeploy.
3. If the leak was a git commit: rotating is mandatory and sufficient. Rewriting
   history does **not** un-leak anything already pushed — treat the value as
   permanently burned.

**Within hours**

4. Check the provider's logs for use you cannot account for: Supabase
   (*Logs → API / Postgres*), Resend (*Logs*), Upstash (*Usage*), Google Cloud
   (*Audit logs*).
5. Rotate anything that shared the exposure path (same file, same message, same
   screenshot).
6. If the service role key or the database password was involved, assume tenant
   data was readable and check `/admin/auditoria` and the Supabase logs for
   unexpected access.

**Afterwards**

7. Record what leaked, how, when it was rotated, and what the logs showed. Keep
   that record outside this repository.

---

## 5. Rules

**Do**

- Keep every secret in Vercel's environment variables or in `.env.local`.
- Share secrets through a password manager or another end-to-end encrypted
  channel — never chat, email, a ticket, or a commit.
- Give each environment its own values where the provider allows it.
- Use referrer/domain restrictions for keys that must be public
  (`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`).
- Scan before committing:
  ```bash
  git diff --cached | grep -iE 'eyJ[A-Za-z0-9_-]{10,}|re_[A-Za-z0-9]{10,}|sk_[A-Za-z0-9]{10,}|-----BEGIN'
  ```

**Do not**

- Commit `.env.local`, `.env.production`, or any `*.key` / `*.json` service
  credential.
- Paste real values into documentation, including this file.
- Log credential values, or echo them in CI output.
- Ship `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_CLIENT_SECRET` to the browser —
  the `NEXT_PUBLIC_` prefix is what makes a variable client-visible, so never
  add it to a secret.

---

## 6. Related

- [`.env.example`](./.env.example) — canonical, commented variable list.
- [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md) — where each value
  comes from.
- [`docs/PII_SCRUBBING.md`](./docs/PII_SCRUBBING.md) — what is stripped before
  errors leave the app.
- [`docs/AUDIT_LOGGING.md`](./docs/AUDIT_LOGGING.md) — audit trail of user and
  admin actions (surfaced at `/admin/auditoria`).
- [`AUDITORIA_2026-09-03.md`](./AUDITORIA_2026-09-03.md) — most recent security
  and quality audit.
- [`MIGRACION.md`](./MIGRACION.md) — regenerating every credential in new
  accounts.

> **Historical note:** revisions of this document before 2026-09-09 described
> `ALERTS_EMAIL_RECIPIENTS`, `ALERTS_FROM_ADDRESS`,
> `ERROR_DIGEST_EMAIL_RECIPIENTS`, `ON_CALL_EMAIL`, `ENGINEERING_LEAD_EMAIL`,
> `INFRASTRUCTURE_TEAM_EMAIL`, `SMTP_*`, PagerDuty and Twilio credentials, and
> an SMTP/nodemailer validation script. None of those variables are read
> anywhere in the codebase and nodemailer is not a dependency: they came from a
> generic observability boilerplate. Alerting today is a single webhook
> (`ALERT_WEBHOOK_URL`) and email goes through Resend.
