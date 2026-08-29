/**
 * Fetches a fresh, usable Google access token for an organization's
 * connected account. Server-only — reads the refresh token via the
 * get_google_refresh_token RPC, which is revoked from anon/authenticated
 * and only callable with the service-role key (see the migration that
 * created it: 20260829001000_google_integration_foundation.sql).
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { refreshAccessToken } from "./oauth";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role configuration missing");
  return createClient<Database>(url, key);
}

/**
 * Returns a fresh access token for the org's connected Google account, or
 * null if Google isn't connected for this tenant. Never throws for "not
 * connected" — callers (Calendar sync, Drive lookup) should treat that as
 * "skip, nothing to do", not an error.
 */
export async function getGoogleAccessToken(tenantId: string): Promise<string | null> {
  const supabase = getServiceClient();
  // Untyped RPC call: get_google_refresh_token isn't in the generated
  // Database types' rpc union (the type generator only picks up RPCs
  // granted to authenticated/anon; this one is intentionally revoked from
  // both). See notify.ts's getServiceClient for the same untyped-client
  // pattern used elsewhere for RPCs the generator can't see.
  const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: object) => Promise<{ data: string | null; error: { message: string } | null }> }).rpc(
    "get_google_refresh_token",
    { p_tenant_id: tenantId }
  );

  if (error) {
    console.error("Failed to fetch Google refresh token", { tenantId, error: error.message });
    return null;
  }
  if (!data) return null;

  return refreshAccessToken(data);
}
