import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  relatedTaskId: string | null;
  readAt: string | null;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["notifications"]["Row"]): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    relatedTaskId: row.related_task_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// RLS (notifications_select_own) ya filtra a user_id = auth.uid(); el filtro
// explícito aquí es solo defensivo/legible, no aporta seguridad adicional.
export async function fetchNotifications(supabase: TypedClient, userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function markNotificationRead(supabase: TypedClient, notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(supabase: TypedClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
}

// Push en tiempo real (Supabase Realtime sobre replicación lógica) en vez de
// WebSocket propio del plan original — mismo resultado con el stack actual,
// sin infraestructura adicional. Devuelve la unsubscribe function.
export function subscribeToNotifications(
  supabase: TypedClient,
  userId: string,
  onInsert: (n: AppNotification) => void
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => onInsert(mapRow(payload.new as Database["public"]["Tables"]["notifications"]["Row"]))
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
