import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface ViewFilters {
  searchQuery?: string;
  assigneeUserId?: string | null;
  priority?: string | null;
  tag?: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  filters: ViewFilters;
}

function mapRow(row: Database["public"]["Tables"]["saved_views"]["Row"]): SavedView {
  const raw = row.filters;
  const filters = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ViewFilters) : {};
  return { id: row.id, name: row.name, filters };
}

/** Only the current user's own saved views (RLS-enforced regardless). */
export async function fetchSavedViews(supabase: TypedClient, boardId: string): Promise<SavedView[]> {
  const { data, error } = await supabase
    .from("saved_views")
    .select("*")
    .eq("board_id", boardId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createSavedView(
  supabase: TypedClient,
  boardId: string,
  userId: string,
  name: string,
  filters: ViewFilters
): Promise<SavedView> {
  const { data, error } = await supabase
    .from("saved_views")
    .insert({ board_id: boardId, user_id: userId, name, filters: filters as unknown as Json })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteSavedView(supabase: TypedClient, id: string): Promise<void> {
  const { error } = await supabase.from("saved_views").delete().eq("id", id);
  if (error) throw error;
}
