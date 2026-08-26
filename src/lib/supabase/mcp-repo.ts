import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface McpSession {
  id: string;
  name: string;
  client: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedMcpSession {
  sessionId: string;
  token: string;
}

function mapRow(
  row: Pick<
    Database["public"]["Tables"]["mcp_sessions"]["Row"],
    "id" | "name" | "client" | "token_scopes" | "created_at" | "last_used_at" | "revoked_at"
  >
): McpSession {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    scopes: row.token_scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export async function fetchMcpSessions(supabase: TypedClient, userId: string): Promise<McpSession[]> {
  const { data, error } = await supabase
    .from("mcp_sessions")
    .select("id, name, client, token_scopes, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createMcpSession(
  supabase: TypedClient,
  client: string,
  name: string,
  scopes: string[]
): Promise<CreatedMcpSession> {
  const { data, error } = await supabase.rpc("create_mcp_session", {
    p_client: client,
    p_name: name,
    p_scopes: scopes,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("No se pudo crear el token de acceso.");
  return { sessionId: row.session_id, token: row.token };
}

export async function revokeMcpSession(supabase: TypedClient, sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_mcp_session", { p_session_id: sessionId });
  if (error) throw error;
}
