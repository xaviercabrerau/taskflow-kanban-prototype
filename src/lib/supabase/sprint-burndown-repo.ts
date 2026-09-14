import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  total: number;
  remaining: number;
}

export async function fetchSprintBurndown(supabase: TypedClient, sprintId: string): Promise<BurndownPoint[]> {
  const { data, error } = await supabase
    .from("metrics_snapshots")
    .select("snapshot_date, value")
    .eq("sprint_id", sprintId)
    .eq("metric_type", "sprint_burndown")
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const value = row.value as { total?: number; remaining?: number };
    return {
      date: row.snapshot_date,
      total: value.total ?? 0,
      remaining: value.remaining ?? 0,
    };
  });
}
