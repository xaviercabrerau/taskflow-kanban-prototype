/**
 * Google OAuth 2.0 (authorization code flow) for the shared Calendar/Drive/
 * Gmail integration. Deliberately implemented with plain fetch against
 * Google's REST endpoints rather than the `googleapis` SDK — the SDK was
 * removed earlier as an unused dependency (see git history), and a REST
 * call is all three of these OAuth steps need.
 *
 * Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI
 * to be set (a human must create a project in Google Cloud Console, enable
 * the Calendar/Drive/Gmail APIs, and configure an OAuth consent screen +
 * these credentials — see OBSERVABILITY.md). Until then, every function
 * here throws a clear "not configured" error rather than silently no-op'ing,
 * since these calls only ever happen when a user explicitly clicks
 * "Conectar cuenta de Google".
 */

import jwt from "jsonwebtoken";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// calendar.events: create/update/delete events for task due dates.
// drive.readonly: read metadata/content of files the user explicitly shares
// a link to — never used to browse/list a user's whole Drive.
// gmail.send: send-as the connected account (distinct from and in addition
// to the Resend-based path in notify.ts; not wired into notify.ts yet).
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "email",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} no está configurado — Google no está conectado todavía. Ver OBSERVABILITY.md.`
    );
  }
  return value;
}

/** Signed, short-lived state param — carries tenantId through Google's redirect and guards against CSRF. */
export function buildOAuthState(tenantId: string, userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET no está configurado.");
  return jwt.sign({ tenantId, userId }, secret, { expiresIn: "10m" });
}

export function verifyOAuthState(state: string): { tenantId: string; userId: string } {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET no está configurado.");
  const decoded = jwt.verify(state, secret) as { tenantId: string; userId: string };
  if (!decoded.tenantId || !decoded.userId) {
    throw new Error("Parámetro state inválido.");
  }
  return decoded;
}

export function buildGoogleAuthUrl(state: string): string {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requireEnv("GOOGLE_OAUTH_REDIRECT_URI");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline", // needed to get a refresh_token
    prompt: "consent", // force refresh_token on reconnect too, not just first consent
    scope: SCOPES.join(" "),
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  grantedScopes: string[];
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_OAUTH_REDIRECT_URI");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google rechazó el intercambio de código: ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in,
    grantedScopes: data.scope.split(" "),
  };
}

/** Access tokens are short-lived (~1h) — always refresh on demand rather than tracking expiry. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`No se pudo renovar el token de Google: ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

export async function fetchConnectedEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}
