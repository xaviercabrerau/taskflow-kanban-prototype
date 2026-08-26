import { createClient } from "@supabase/supabase-js";

// pg_cron job health check.
//
// `cron.job_run_details` lives in the `cron` schema, which PostgREST does
// not expose and which the anon/authenticated roles cannot read directly.
// The correct way to surface this to the app is the `get_cron_health()`
// SECURITY DEFINER RPC (supabase/migrations/20260810231215_cron_health_rpc.sql,
// job names corrected in 20260810231315_fix_cron_health_rpc_job_names.sql)
// — it runs with the function owner's privileges to read
// `cron.job_run_details` internally, but only ever returns the four
// hardcoded job names below.
//
// NOTE: this RPC was originally granted to `authenticated` only, and this
// handler forwards whatever `Authorization` header it receives so a
// signed-in user's session reaches Supabase. That grant is no longer the
// only way in, though: 20260810235939_grant_cron_health_to_anon.sql later
// also granted `anon` EXECUTE on this same function, for the benefit of
// src/app/api/cron/alert-check/route.ts (a CRON_SECRET-gated scheduled
// endpoint with no user session to forward). As a side effect, THIS
// endpoint is now also callable with no Authorization header at all — the
// auth-forwarding below is no longer an access-control boundary, just a
// convenience for a signed-in caller. This is an accepted tradeoff: the
// data returned (whether 4 known, non-secret job names are stale) was
// already judged low-sensitivity when that grant was added.
//
// We deliberately do NOT use a service-role key here. A service-role key
// bypasses every RLS policy in the project, so shipping one to a Vercel
// serverless function to read four rows of cron history would trade a
// small, well-scoped read for a credential that can read/write everything.
// The RPC approach keeps the elevated privilege inside Postgres, scoped to
// exactly this query.

// Nombres reales de cron.job.jobname (no los nombres de las funciones que
// invocan) — solo se usan en el fallback de error abajo, pero deben
// coincidir con lo que get_cron_health() realmente devuelve.
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

function getAuthedSupabase(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  const authHeader = request.headers.get("authorization") ?? undefined;
  return createClient(
    url,
    anonKey,
    authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined
  );
}

export async function GET(request: Request) {
  const timestamp = new Date().toISOString();

  try {
    const supabase = getAuthedSupabase(request);
    const { data, error } = await supabase.rpc("get_cron_health");

    if (error) {
      return Response.json(
        {
          status: "error",
          message: error.message,
          hint:
            "get_cron_health() may not exist yet (apply supabase/migrations/20260810231215_cron_health_rpc.sql) " +
            "or the RPC call itself failed — see error.message above.",
          jobs: MONITORED_JOBS.map((job) => ({ jobName: job.name, schedule: job.schedule, status: "unknown" })),
          timestamp,
        },
        { status: 503 }
      );
    }

    const rows = (data ?? []) as CronHealthRow[];
    const jobs = rows.map((row) => ({
      jobName: row.job_name,
      expectedInterval: row.expected_interval,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      isStale: row.is_stale,
    }));

    const anyStale = jobs.some((job) => job.isStale || job.lastStatus === "failed");

    return Response.json(
      {
        status: anyStale ? "degraded" : "ok",
        jobs,
        timestamp,
      },
      { status: anyStale ? 503 : 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ status: "error", message, timestamp }, { status: 503 });
  }
}
