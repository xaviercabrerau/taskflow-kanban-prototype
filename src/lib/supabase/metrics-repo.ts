import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface ThroughputPoint {
  date: string;
  count: number;
}

export interface CycleTimePoint {
  date: string;
  avgHours: number;
  taskCount: number;
}

export interface MetricsReport {
  throughput: ThroughputPoint[];
  cycleTime: CycleTimePoint[];
}

export async function fetchMetricsReport(
  supabase: TypedClient,
  boardId: string,
  from: string,
  to: string
): Promise<MetricsReport> {
  const { data, error } = await supabase
    .from("metrics_snapshots")
    .select("metric_type, snapshot_date, value")
    .eq("board_id", boardId)
    .gte("snapshot_date", from)
    .lte("snapshot_date", to)
    .order("snapshot_date");
  if (error) throw error;

  const throughput: ThroughputPoint[] = [];
  const cycleTime: CycleTimePoint[] = [];
  for (const row of data ?? []) {
    if (typeof row.value !== "object" || row.value === null || Array.isArray(row.value)) {
      continue;
    }
    const value = row.value as Record<string, number>;
    if (row.metric_type === "throughput") {
      throughput.push({ date: row.snapshot_date, count: value.count ?? 0 });
    } else if (row.metric_type === "cycle_time") {
      cycleTime.push({ date: row.snapshot_date, avgHours: value.avg_hours ?? 0, taskCount: value.task_count ?? 0 });
    }
  }
  return { throughput, cycleTime };
}

// Genera (o regenera) el snapshot de métricas de hoy para un board. Cualquier
// miembro puede dispararlo manualmente; el mismo cálculo corre además cada
// noche vía pg_cron para todos los boards.
export async function generateTodaySnapshot(supabase: TypedClient, boardId: string): Promise<void> {
  const { error } = await supabase.rpc("record_daily_metrics_snapshot", { p_board_id: boardId });
  if (error) throw error;
}
