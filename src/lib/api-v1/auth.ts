import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

/**
 * Auth/rate-limit for the public REST API (/api/v1/*) — reuses the exact
 * same personal access tokens (tfmcp_... via create_mcp_session, managed in
 * /admin/api-keys) and the same SECURITY DEFINER RPCs as the JSON-RPC MCP
 * endpoint (/api/mcp/route.ts). Kept as a separate, plainer REST surface
 * because not every integration wants to speak MCP/JSON-RPC.
 */
export function extractApiToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  if (!token.startsWith("tfmcp_") || token.length < 20) return null;
  return token;
}

export function getApiSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export interface ApiAuthResult {
  token: string;
  supabase: ReturnType<typeof getApiSupabase>;
}

/** Returns either an authenticated { token, supabase } or a ready-to-return NextResponse error. */
export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult | NextResponse> {
  const token = extractApiToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header. Expected: Bearer tfmcp_..." },
      { status: 401 }
    );
  }

  const rateLimit = await checkRateLimit(deriveRateLimitKey(token));
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
  }

  return { token, supabase: getApiSupabase() };
}

export function isAuthError(result: ApiAuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/** Same generic-error policy as safeToolError in /api/mcp: never leak raw Postgres error text. */
export function safeApiError(context: string, error: { message: string; code?: string }): string {
  console.error(`[api/v1:${context}]`, error.code ?? "", error.message);
  if (error.message?.toLowerCase().includes("invalid or expired token")) {
    return "Invalid or expired token.";
  }
  return "The request could not be completed. Check the parameters and try again.";
}
