import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

// Matches the DB check constraint on task_links.link_type.
export type LinkType = "blocks" | "related_to" | "duplicates";

export interface TaskLink {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  linkType: LinkType;
}

/** All links touching a task, in either direction (as source or target). */
export async function fetchTaskLinks(supabase: TypedClient, taskId: string): Promise<TaskLink[]> {
  const { data, error } = await supabase
    .from("task_links")
    .select("id, source_task_id, target_task_id, link_type")
    .or(`source_task_id.eq.${taskId},target_task_id.eq.${taskId}`);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    sourceTaskId: r.source_task_id,
    targetTaskId: r.target_task_id,
    linkType: r.link_type as LinkType,
  }));
}

export async function createTaskLink(
  supabase: TypedClient,
  sourceTaskId: string,
  targetTaskId: string,
  linkType: LinkType
): Promise<TaskLink> {
  const { data, error } = await supabase
    .from("task_links")
    .insert({ source_task_id: sourceTaskId, target_task_id: targetTaskId, link_type: linkType })
    .select("id, source_task_id, target_task_id, link_type")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    sourceTaskId: data.source_task_id,
    targetTaskId: data.target_task_id,
    linkType: data.link_type as LinkType,
  };
}

export async function deleteTaskLink(supabase: TypedClient, linkId: string): Promise<void> {
  const { error } = await supabase.from("task_links").delete().eq("id", linkId);
  if (error) throw error;
}
