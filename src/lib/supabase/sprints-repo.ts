import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

// Matches the DB check constraint on sprints.status.
export type SprintStatus = "planned" | "active" | "closed";

export interface Sprint {
  id: string;
  boardId: string;
  name: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  status: SprintStatus;
}

function mapRow(row: Database["public"]["Tables"]["sprints"]["Row"]): Sprint {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    startDate: row.start_date ? row.start_date.slice(0, 10) : null,
    endDate: row.end_date ? row.end_date.slice(0, 10) : null,
    status: row.status as SprintStatus,
  };
}

export async function fetchSprints(supabase: TypedClient, boardId: string): Promise<Sprint[]> {
  const { data, error } = await supabase
    .from("sprints")
    .select("*")
    .eq("board_id", boardId)
    .order("start_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createSprint(
  supabase: TypedClient,
  boardId: string,
  input: { name: string; startDate: string | null; endDate: string | null }
): Promise<Sprint> {
  const { data, error } = await supabase
    .from("sprints")
    .insert({ board_id: boardId, name: input.name, start_date: input.startDate, end_date: input.endDate, status: "planned" })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateSprintStatus(supabase: TypedClient, sprintId: string, status: SprintStatus): Promise<void> {
  const { error } = await supabase.from("sprints").update({ status }).eq("id", sprintId);
  if (error) throw error;
}

export async function deleteSprint(supabase: TypedClient, sprintId: string): Promise<void> {
  const { error } = await supabase.from("sprints").delete().eq("id", sprintId);
  if (error) throw error;
}
