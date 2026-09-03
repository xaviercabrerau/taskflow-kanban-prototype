import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface PortfolioBoardSummary {
  boardId: string;
  boardName: string;
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
}

export async function fetchPortfolioSummary(supabase: TypedClient): Promise<PortfolioBoardSummary[]> {
  const { data, error } = await supabase.rpc("portfolio_summary");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    boardId: r.board_id,
    boardName: r.board_name,
    totalTasks: Number(r.total_tasks),
    doneTasks: Number(r.done_tasks),
    overdueTasks: Number(r.overdue_tasks),
  }));
}
