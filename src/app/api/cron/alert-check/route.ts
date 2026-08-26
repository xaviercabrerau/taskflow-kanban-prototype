import { timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Scheduled alerting endpoint.
//
// This route is meant to be hit on a schedule (Vercel Cron, and/or an
// external uptime monitor) rather than by a human or a signed-in user. It
// authenticates the CALLER with a shared secret instead of a Supabase
// session, then internally runs the same two checks the two existing
// health endpoints expose (`/api/health` and `/api/health/cron`), and pages
// a Slack/Discord webhook if either one reports a problem.
//
// --- Auth ---
// Requires `Authorization: Bearer <CRON_SECRET>` matching
// `process.env.CRON_SECRET`, OR (fallback, checked only when the header is
// absent) a `?secret=<CRON_SECRET>` query param. The query-param fallback
// exists because Vercel's own Cron scheduler sends the header automatically
// when `CRON_SECRET` is set, but many free-tier external uptime monitors
// (UptimeRobot, Freshping, etc.) cannot send custom headers — only a custom
// URL. Both paths require an exact match; anything else is a 401.
//
// --- Cron health via anon client ---
// `get_cron_health()` was originally granted to `authenticated` only (see
// src/app/api/health/cron/route.ts), which doesn't work here since there is
// no signed-in user in a cron-triggered request. Because this whole route
// is already gated by CRON_SECRET above, we deliberately also granted `anon`
// EXECUTE on that RPC (supabase/migrations/20260810235939_grant_cron_health_to_anon.sql,
// applied) — the data it returns (whether 4 known, non-secret job names are
// stale) is low-sensitivity, and access to it is already gated one layer up
// by CRON_SECRET.

// Nombres reales de cron.job.jobname (NO los nombres de las funciones que
// invocan) — get_cron_health() los devuelve tal cual; si no coinciden acá,
// esta ruta reporta "no reportó estado" para los 4 jobs en cada corrida.
const MONITORED_JOBS = [
  { name: "taskflow_check_due_soon_tasks", schedule: "hourly" },
  { name: "taskflow_execute_due_date_automations", schedule: "hourly" },
  { name: "purge-expired-audit-logs", schedule: "daily" },
  { name: "record-daily-metrics-snapshots", schedule: "daily" },
] as const;

interface CronHealthRow {
  job_name: string;
  expected_interval: string;
  last_run_at: string | null;
  last_status: string | null;
  is_stale: boolean;
}

function getSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Untyped client for `get_cron_health()`, mirroring
// src/app/api/health/cron/route.ts: the generated `Database` types don't
// yet include this RPC's signature (it's granted to `anon` by a migration
// that hasn't been applied to the live DB yet — see the comment above), so
// a typed client would reject the RPC name at compile time.
function getUntypedSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    return timingSafeStringEqual(authHeader, `Bearer ${cronSecret}`);
  }

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  return querySecret !== null && timingSafeStringEqual(querySecret, cronSecret);
}

async function checkAppHealth(): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("permissions").select("id").limit(1);
    if (error) {
      return `App health check failed: ${error.message}`;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return `Could not reach Supabase to check app health: ${message}`;
  }
}

async function checkCronHealth(): Promise<string[]> {
  try {
    const supabase = getUntypedSupabase();
    const { data, error } = await supabase.rpc("get_cron_health");

    if (error) {
      return [`Could not reach Supabase to check cron health: ${error.message}`];
    }

    const rows = (data ?? []) as CronHealthRow[];
    const problems: string[] = [];

    for (const row of rows) {
      if (row.is_stale || row.last_status === "failed") {
        const lastRun = row.last_run_at ?? "never";
        const status = row.last_status ?? "unknown";
        problems.push(
          `Cron job "${row.job_name}" is ${row.is_stale ? "stale" : "reporting a failure"} ` +
            `(last run: ${lastRun}, last status: ${status})`
        );
      }
    }

    // If the RPC returned fewer rows than expected, flag the missing jobs too.
    const seenJobs = new Set(rows.map((row) => row.job_name));
    for (const job of MONITORED_JOBS) {
      if (!seenJobs.has(job.name)) {
        problems.push(`Cron job "${job.name}" did not report any status`);
      }
    }

    return problems;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return [`Could not reach Supabase to check cron health: ${message}`];
  }
}

async function sendAlert(problems: string[], timestamp: string): Promise<boolean> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const message = `TaskFlow alert (${timestamp}):\n${problems.map((p) => `- ${p}`).join("\n")}`;

  if (!webhookUrl) {
    console.error(message);
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Sending both `text` (Slack incoming webhooks) and `content`
      // (Discord webhooks) in the same payload lets one implementation
      // work for either provider — both ignore keys they don't recognize.
      body: JSON.stringify({ text: message, content: message }),
    });

    if (!response.ok) {
      console.error(
        `Alert webhook responded with ${response.status}. Original alert: ${message}`
      );
      return false;
    }

    return true;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Failed to POST to ALERT_WEBHOOK_URL: ${errMessage}. Original alert: ${message}`);
    return false;
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  const problems: string[] = [];

  const appProblem = await checkAppHealth();
  if (appProblem) problems.push(appProblem);

  const cronProblems = await checkCronHealth();
  problems.push(...cronProblems);

  let alerted = false;
  if (problems.length > 0) {
    alerted = await sendAlert(problems, timestamp);
  }

  const status = problems.length > 0 && !alerted ? 503 : 200;
  return Response.json({ ok: true, problems, alerted, timestamp }, { status });
}
