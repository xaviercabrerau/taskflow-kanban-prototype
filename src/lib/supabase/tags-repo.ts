import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

function mapRow(row: Database["public"]["Tables"]["tags"]["Row"]): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
  };
}

export async function fetchOrgTags(supabase: TypedClient, tenantId: string): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

// RLS (task_tags_all) ya limita a miembros de la organización de la tarea;
// el join aquí es solo para traer los datos, no aporta seguridad extra.
export async function fetchTaskTags(supabase: TypedClient, taskId: string): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("task_tags")
    .select("tags(*)")
    .eq("task_id", taskId);
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.tags)
    .filter((tag): tag is Database["public"]["Tables"]["tags"]["Row"] => tag !== null)
    .map(mapRow);
}

export async function createTag(
  supabase: TypedClient,
  tenantId: string,
  name: string,
  color: string
): Promise<Tag> {
  const { data, error } = await supabase
    .from("tags")
    .insert({ tenant_id: tenantId, name, color })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function addTagToTask(supabase: TypedClient, taskId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from("task_tags").insert({ task_id: taskId, tag_id: tagId });
  if (error) throw error;
}

export async function removeTagFromTask(supabase: TypedClient, taskId: string, tagId: string): Promise<void> {
  const { error } = await supabase
    .from("task_tags")
    .delete()
    .eq("task_id", taskId)
    .eq("tag_id", tagId);
  if (error) throw error;
}
