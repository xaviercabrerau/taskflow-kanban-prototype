import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export type CustomFieldType = "text" | "number" | "select" | "checkbox";

export interface CustomFieldDefinition {
  id: string;
  boardId: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null; // only meaningful for "select"
  isRequired: boolean;
  orderIndex: number;
}

function mapRow(row: Database["public"]["Tables"]["custom_field_definitions"]["Row"]): CustomFieldDefinition {
  const rawOptions = row.options;
  return {
    id: row.id,
    boardId: row.board_id,
    key: row.key,
    label: row.label,
    fieldType: row.field_type as CustomFieldType,
    options: Array.isArray(rawOptions) ? rawOptions.filter((o): o is string => typeof o === "string") : null,
    isRequired: row.is_required,
    orderIndex: row.order_index,
  };
}

export async function fetchFieldDefinitions(supabase: TypedClient, boardId: string): Promise<CustomFieldDefinition[]> {
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .select("*")
    .eq("board_id", boardId)
    .order("order_index");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createFieldDefinition(
  supabase: TypedClient,
  boardId: string,
  input: { key: string; label: string; fieldType: CustomFieldType; options: string[] | null; isRequired: boolean; orderIndex: number }
): Promise<CustomFieldDefinition> {
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({
      board_id: boardId,
      key: input.key,
      label: input.label,
      field_type: input.fieldType,
      options: input.options,
      is_required: input.isRequired,
      order_index: input.orderIndex,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteFieldDefinition(supabase: TypedClient, id: string): Promise<void> {
  const { error } = await supabase.from("custom_field_definitions").delete().eq("id", id);
  if (error) throw error;
}
