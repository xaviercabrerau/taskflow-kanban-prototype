import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface SearchResult {
  taskId: string;
  taskTitle: string;
  matchType: "task" | "comment" | "attachment";
  snippet: string;
}

/** Global search across task titles/descriptions, comments, and attachment names for a board. */
export async function searchWorkspace(supabase: TypedClient, boardId: string, query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("search_workspace", { p_board_id: boardId, p_query: query });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    taskId: r.task_id,
    taskTitle: r.task_title,
    matchType: r.match_type as SearchResult["matchType"],
    snippet: r.snippet,
  }));
}
