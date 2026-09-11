# TaskFlow — Deployment Documentation Index

> **What this document covers:** nothing but the map. It tells you which of the
> deployment documents to open for the task you have. Every procedure lives in
> the documents it points to.
> **Start elsewhere if:** you have never seen the project → [`README.md`](./README.md).

**Last verified:** 2026-09-09.

---

## Pick your task

| I want to… | Read |
|---|---|
| Understand the project, stack, and run it locally | [`README.md`](./README.md) |
| Deploy to the existing production environment | [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) |
| Confirm an environment is fully configured before deploying | [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md) |
| Stand up a **new** environment from zero (staging, demo) | [`DEPLOYMENT_PLAN.md`](./DEPLOYMENT_PLAN.md) |
| Move the **live** installation to other GitHub / Vercel / Supabase accounts | [`MIGRACION.md`](./MIGRACION.md) |
| Find out where a credential's value comes from | [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md) |
| Rotate a secret, or handle a leak | [`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md) |
| See the canonical list of environment variables | [`.env.example`](./.env.example) |
| Know what monitoring and alerting actually exist | [`OBSERVABILITY.md`](./OBSERVABILITY.md) |
| Read the latest security/quality audit | [`AUDITORIA_2026-09-03.md`](./AUDITORIA_2026-09-03.md) |
| Look up an API endpoint | [`docs/API_ENDPOINTS.md`](./docs/API_ENDPOINTS.md) |

**Rule of thumb:** `DEPLOYMENT_PLAN.md` is *first time*, `DEPLOYMENT_GUIDE.md`
is *every time*, `MIGRACION.md` is *different accounts*. Where they overlap,
`MIGRACION.md` wins for migrations and `DEPLOYMENT_GUIDE.md` wins for routine
deploys.

---

## The environment in one table

| Item | Value |
|---|---|
| Public URL | `https://task.conto.ec` |
| Repository | `github.com/xaviercabrerau/taskflow-kanban-prototype`, branch `main` |
| Vercel project | `taskflow-kanban-prototype` (`projectId: prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`, `orgId: team_LUyGoTDapYDMjHCRVzQaFiaX`) |
| Supabase project ref | `txdyijyswpsalqnwfopc` |
| Framework | Next.js 16.3.0 (App Router), React 19.2.8, TypeScript 5 |
| Migrations | 114 versioned files in `supabase/migrations/` |
| Tests | Jest — 15 suites, 215 tests, all passing |
| Cron | exactly one: `/api/cron/alert-check` at `0 8 * * *` (08:00 UTC) |
| CI | none — checks are run manually before each push |

> **Migration note:** these identifiers belong to the accounts in use today.
> They are kept real on purpose, not turned into placeholders. To move them,
> follow [`MIGRACION.md`](./MIGRACION.md), which also lists every place they
> appear.

---

## The 60-second version

```bash
# Verify (all four must pass — there is no CI)
npx tsc --noEmit && npm run lint && npm test && npm run build

# Schema changes first, if any
supabase link --project-ref txdyijyswpsalqnwfopc && supabase db push

# Deploy
git push origin main          # Vercel builds from main
# or: vercel deploy --prod

# Verify
curl -s https://task.conto.ec/api/health        # {"status":"ok",...}
curl -s https://task.conto.ec/api/health/cron   # no stale jobs
```

Details, rollback and the browser checklist: [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md).

---

## Historical documents — not part of any current procedure

These are kept for the record. They describe a planning exercise from
2026-08-18 around a notification architecture (Gmail service accounts, Pub/Sub,
BullMQ workers, Slack alerting, PagerDuty, Twilio, Datadog) and a set of "11
blockers" that were framed against services this project never wired up. Do not
follow them:

- `BLOCKERS_RESOLUTION.md`, `BLOCKERS_FIXED.md`, `BLOCKERS_9_10_11_FIXES.md`
- `VALIDATION_REPORT.md`, `INTEGRATION_SUMMARY.md`
- `docs/PRODUCTION_READINESS_CHECKLIST.md`, `docs/DATADOG_SETUP.md`
- `verify-blockers-fixed.sh`, `scripts/validate-environment.sh`
  (the latter still checks Slack/PagerDuty/Twilio/Datadog/Gmail variables the
  app does not read — use [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md)
  instead)

What the project actually runs on today: Supabase, Vercel, Resend, Upstash
Redis, and optionally Sentry and Google Cloud OAuth.
