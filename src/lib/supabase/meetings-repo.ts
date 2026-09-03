import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface TaskMeetInfo {
  meetLink: string | null;
  meetScheduledAt: string | null;
}

/**
 * Reads the (at most one) scheduled Google Meet for a task. RLS-protected
 * like any other task read — no separate authorization needed here.
 */
export async function fetchTaskMeetInfo(supabase: TypedClient, taskId: string): Promise<TaskMeetInfo> {
  const { data, error } = await supabase
    .from("tasks")
    .select("meet_link, meet_scheduled_at")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return {
    meetLink: data?.meet_link ?? null,
    meetScheduledAt: data?.meet_scheduled_at ?? null,
  };
}
