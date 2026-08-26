import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Lightweight liveness/connectivity probe, safe to hit from an uptime
// monitor at any frequency. Queries `permissions`, a global permission
// catalog whose `permissions_select` RLS policy is `qual = true` (readable
// by anyone, including anon — it's a static catalog, not tenant data).
// Any tenant-scoped table (organizations, boards, tasks, ...) is out: its
// RLS calls is_org_member()/is_org_owner(), and anon's EXECUTE on those was
// deliberately revoked this session, so an anon read now throws
// "permission denied for function is_org_member" instead of returning an
// empty array — that would make this probe report "down" on every request
// even when Supabase is fully healthy. PostgREST's own root endpoint
// (`/rest/v1/`) isn't a safe substitute either: it requires a secret API
// key, which this app never holds.
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  return createClient<Database>(url, anonKey);
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const startedAt = performance.now();

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("permissions").select("id").limit(1);
    const latencyMs = Math.round(performance.now() - startedAt);

    if (error) {
      return Response.json(
        {
          status: "error",
          checks: {
            supabase: { ok: false, latencyMs, message: error.message },
          },
          timestamp,
        },
        { status: 503 }
      );
    }

    return Response.json(
      {
        status: "ok",
        checks: {
          supabase: { ok: true, latencyMs },
        },
        timestamp,
      },
      { status: 200 }
    );
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      {
        status: "error",
        checks: {
          supabase: { ok: false, latencyMs, message },
        },
        timestamp,
      },
      { status: 503 }
    );
  }
}
