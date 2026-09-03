import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export type ShareScope = "board" | "task";
export type SharePermission = "view" | "comment";

export interface ShareLink {
  id: string;
  boardId: string;
  taskId: string | null;
  scope: ShareScope;
  permission: SharePermission;
  label: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["public_share_links"]["Row"]): ShareLink {
  return {
    id: row.id,
    boardId: row.board_id,
    taskId: row.task_id,
    scope: row.scope as ShareScope,
    permission: row.permission as SharePermission,
    label: row.label,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
  };
}

// RLS (public_share_links_all) ya limita a miembros de la organización del
// tablero; el filtro por board_id aquí es defensivo/legible.
export async function fetchShareLinks(supabase: TypedClient, boardId: string): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from("public_share_links")
    .select("*")
    .eq("board_id", boardId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createShareLink(
  supabase: TypedClient,
  boardId: string,
  scope: ShareScope,
  permission: SharePermission,
  options?: { taskId?: string | null; expiresAt?: string | null; label?: string | null }
): Promise<{ link: ShareLink; token: string }> {
  const { data, error } = await supabase.rpc("create_share_link", {
    p_board_id: boardId,
    // Generated types mark these params as `string` (not nullable) even
    // though the SQL function accepts null for task_id/expires_at/label —
    // pg_typegen doesn't infer plpgsql nullability from usage, only from
    // the declared arg type. Casting here documents that this is intentional.
    p_task_id: (options?.taskId ?? null) as unknown as string,
    p_scope: scope,
    p_permission: permission,
    p_expires_at: (options?.expiresAt ?? null) as unknown as string,
    p_label: (options?.label ?? null) as unknown as string,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("No se pudo crear el link.");

  const { data: linkRow, error: fetchError } = await supabase
    .from("public_share_links")
    .select("*")
    .eq("id", row.link_id)
    .single();
  if (fetchError) throw fetchError;

  return { link: mapRow(linkRow), token: row.token };
}

export async function revokeShareLink(supabase: TypedClient, linkId: string): Promise<void> {
  const { error } = await supabase
    .from("public_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) throw error;
}
