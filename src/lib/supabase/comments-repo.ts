import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface TaskComment {
  id: string;
  taskId: string;
  parentCommentId: string | null;
  authorId: string | null;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
  editedAt: string | null;
}

function mapRow(row: Database["public"]["Tables"]["comments"]["Row"]): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    parentCommentId: row.parent_comment_id,
    authorId: row.author_id,
    body: row.body,
    mentionedUserIds: row.mentioned_user_ids ?? [],
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

// RLS (comments_all) ya limita a miembros de la organización de la tarea;
// el filtro por task_id aquí es defensivo/legible, no aporta seguridad extra.
export async function fetchComments(supabase: TypedClient, taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function addComment(
  supabase: TypedClient,
  taskId: string,
  body: string,
  authorId: string | null,
  options?: { mentionedUserIds?: string[]; parentCommentId?: string | null }
): Promise<TaskComment> {
  const { data, error } = await supabase
    .from("comments")
    .insert({
      task_id: taskId,
      body,
      author_id: authorId,
      mentioned_user_ids: options?.mentionedUserIds ?? [],
      parent_comment_id: options?.parentCommentId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}
