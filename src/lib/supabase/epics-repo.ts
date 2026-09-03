import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface Epic {
  id: string;
  boardId: string;
  name: string;
  color: string | null;
  status: string | null;
}

function mapRow(row: Database["public"]["Tables"]["epics"]["Row"]): Epic {
  return { id: row.id, boardId: row.board_id, name: row.name, color: row.color, status: row.status };
}

export async function fetchEpics(supabase: TypedClient, boardId: string): Promise<Epic[]> {
  const { data, error } = await supabase.from("epics").select("*").eq("board_id", boardId).order("name");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createEpic(supabase: TypedClient, boardId: string, name: string, color: string | null): Promise<Epic> {
  const { data, error } = await supabase
    .from("epics")
    .insert({ board_id: boardId, name, color, status: "active" })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateEpicStatus(supabase: TypedClient, epicId: string, status: string): Promise<void> {
  const { error } = await supabase.from("epics").update({ status }).eq("id", epicId);
  if (error) throw error;
}

export async function deleteEpic(supabase: TypedClient, epicId: string): Promise<void> {
  const { error } = await supabase.from("epics").delete().eq("id", epicId);
  if (error) throw error;
}
