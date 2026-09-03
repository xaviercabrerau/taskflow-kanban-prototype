import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  note: string | null;
}

function mapRow(row: Database["public"]["Tables"]["time_entries"]["Row"]): TimeEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: row.minutes,
    note: row.note,
  };
}

export async function fetchTaskTimeEntries(supabase: TypedClient, taskId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Starts a timer — fails with a unique-constraint error if one is already running for this user+task. */
export async function startTimer(supabase: TypedClient, taskId: string, userId: string): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from("time_entries")
    .insert({ task_id: taskId, user_id: userId })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function stopTimer(supabase: TypedClient, entryId: string, startedAt: string): Promise<TimeEntry> {
  const endedAt = new Date();
  const minutes = Math.max(1, Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 60000));
  const { data, error } = await supabase
    .from("time_entries")
    .update({ ended_at: endedAt.toISOString(), minutes })
    .eq("id", entryId)
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function addManualEntry(
  supabase: TypedClient,
  taskId: string,
  userId: string,
  minutes: number,
  note: string | null
): Promise<TimeEntry> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_entries")
    .insert({ task_id: taskId, user_id: userId, started_at: now, ended_at: now, minutes, note })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteTimeEntry(supabase: TypedClient, entryId: string): Promise<void> {
  const { error } = await supabase.from("time_entries").delete().eq("id", entryId);
  if (error) throw error;
}

/** For the workload/hours report: every completed entry across a set of tasks (e.g. a whole board). */
export async function fetchTimeEntriesForTasks(supabase: TypedClient, taskIds: string[]): Promise<TimeEntry[]> {
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase.from("time_entries").select("*").in("task_id", taskIds).not("minutes", "is", null);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
