/**
 * Server-only accessor for an organization's configured AI credential
 * (OpenAI or Anthropic, whichever is active in /admin/integraciones).
 * Reads via get_ai_credential, which is revoked from anon/authenticated and
 * only callable with the service-role key — same pattern as
 * src/lib/google/client.ts's getGoogleAccessToken.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role configuration missing");
  return createClient<Database>(url, key);
}

export interface AiCredential {
  provider: "openai" | "anthropic";
  apiKey: string;
}

/** Returns null if no AI provider is configured/active for this tenant — callers should treat that as "IA no disponible", not an error. */
export async function getAiCredential(tenantId: string): Promise<AiCredential | null> {
  const supabase = getServiceClient();
  // Untyped RPC call: get_ai_credential isn't in the generated Database
  // types' rpc union (intentionally revoked from authenticated/anon, so the
  // type generator never sees it) — same untyped-client cast as
  // getGoogleAccessToken.
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: object
      ) => Promise<{ data: { provider: string; api_key: string }[] | null; error: { message: string } | null }>;
    }
  ).rpc("get_ai_credential", { p_tenant_id: tenantId });

  if (error) {
    console.error("Failed to fetch AI credential", { tenantId, error: error.message });
    return null;
  }
  const row = data?.[0];
  if (!row) return null;

  return { provider: row.provider as "openai" | "anthropic", apiKey: row.api_key };
}
