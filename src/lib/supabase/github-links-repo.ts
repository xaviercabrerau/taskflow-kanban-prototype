import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface TaskGithubLink {
  id: string;
  taskId: string;
  url: string;
  repo: string;
  number: number;
  kind: "issue" | "pull_request";
  title: string;
  state: string;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["task_github_links"]["Row"]): TaskGithubLink {
  return {
    id: row.id,
    taskId: row.task_id,
    url: row.url,
    repo: row.repo,
    number: row.number,
    kind: row.kind as "issue" | "pull_request",
    title: row.title,
    state: row.state,
    createdAt: row.created_at,
  };
}

export async function fetchTaskGithubLinks(supabase: TypedClient, taskId: string): Promise<TaskGithubLink[]> {
  const { data, error } = await supabase
    .from("task_github_links")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function deleteTaskGithubLink(supabase: TypedClient, id: string): Promise<void> {
  const { error } = await supabase.from("task_github_links").delete().eq("id", id);
  if (error) throw error;
}
