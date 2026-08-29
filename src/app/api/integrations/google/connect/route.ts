import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { buildGoogleAuthUrl, buildOAuthState } from "@/lib/google/oauth";

/**
 * GET /api/integrations/google/connect
 * Redirects the signed-in user to Google's OAuth consent screen. Only an
 * org owner may initiate this — matches the same owner-gating already
 * applied to every other integration write (upsert_integration's RLS).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, org_role")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!membership || membership.org_role !== "owner") {
    return NextResponse.json(
      { error: "Solo el dueño de la organización puede conectar Google." },
      { status: 403 }
    );
  }

  try {
    const state = buildOAuthState(membership.organization_id, authData.user.id);
    return NextResponse.redirect(buildGoogleAuthUrl(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
