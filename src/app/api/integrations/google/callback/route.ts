import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { exchangeCodeForTokens, fetchConnectedEmail, verifyOAuthState } from "@/lib/google/oauth";
import { upsertIntegration } from "@/lib/supabase/integrations-repo";

/**
 * GET /api/integrations/google/callback
 * Google redirects here after the user approves (or denies) the consent
 * screen. Exchanges the code for tokens and stores the refresh token via
 * the existing upsert_integration RPC — same Vault-backed storage every
 * other provider already uses, just with provider='google'.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (error) {
    return NextResponse.redirect(`${origin}/?googleConnect=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/?googleConnect=error`);
  }

  let tenantId: string;
  let userId: string;
  try {
    const decoded = verifyOAuthState(state);
    tenantId = decoded.tenantId;
    userId = decoded.userId;
  } catch {
    return NextResponse.redirect(`${origin}/?googleConnect=error`);
  }

  const supabase = await createServerSupabase();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.id !== userId) {
    // The state param is signed and short-lived, but double-check the
    // callback is being completed by the same session that started it —
    // defense in depth against a stolen/replayed callback URL.
    return NextResponse.redirect(`${origin}/?googleConnect=error`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      // Google only returns a refresh_token on first consent (or when
      // prompt=consent forces re-consent, which connect/route.ts always
      // sets) — if it's still missing here, something is misconfigured.
      return NextResponse.redirect(`${origin}/?googleConnect=error`);
    }

    const connectedEmail = await fetchConnectedEmail(tokens.accessToken);

    await upsertIntegration(
      supabase,
      tenantId,
      "google",
      { connectedEmail, scopes: tokens.grantedScopes },
      tokens.refreshToken,
      true
    );

    return NextResponse.redirect(`${origin}/?googleConnect=success`);
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    return NextResponse.redirect(`${origin}/?googleConnect=error`);
  }
}
