import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface InboundWebhook {
  id: string;
  boardId: string;
  columnId: string;
  // Solo tiene valor justo después de crear el webhook (ver createInboundWebhook) —
  // el token real ya no se guarda en texto plano, así que no puede volver a mostrarse.
  token: string | null;
  isActive: boolean;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["webhooks_inbound"]["Row"]): InboundWebhook {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    token: null,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function fetchInboundWebhooks(supabase: TypedClient, boardId: string): Promise<InboundWebhook[]> {
  const { data, error } = await supabase
    .from("webhooks_inbound")
    .select("*")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createInboundWebhook(
  supabase: TypedClient,
  tenantId: string,
  boardId: string,
  columnId: string
): Promise<InboundWebhook> {
  const { data, error } = await supabase.rpc("create_inbound_webhook", {
    p_tenant_id: tenantId,
    p_board_id: boardId,
    p_column_id: columnId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("No se pudo crear el webhook.");
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    token: row.token,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function toggleInboundWebhook(supabase: TypedClient, id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("webhooks_inbound").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}
