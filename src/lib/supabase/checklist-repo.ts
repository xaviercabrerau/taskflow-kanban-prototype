import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface ChecklistItem {
  id: string;
  checklistId: string;
  label: string;
  isDone: boolean;
  orderIndex: number;
}

export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  orderIndex: number;
  items: ChecklistItem[];
}

function mapItemRow(row: Database["public"]["Tables"]["checklist_items"]["Row"]): ChecklistItem {
  return {
    id: row.id,
    checklistId: row.checklist_id,
    label: row.label,
    isDone: row.is_done,
    orderIndex: row.order_index,
  };
}

function mapChecklistRow(row: Database["public"]["Tables"]["checklists"]["Row"]): Checklist {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    orderIndex: row.order_index,
    items: [],
  };
}

export async function fetchChecklists(supabase: TypedClient, taskId: string): Promise<Checklist[]> {
  const { data: checklistRows, error: checklistsError } = await supabase
    .from("checklists")
    .select("*")
    .eq("task_id", taskId)
    .order("order_index", { ascending: true });
  if (checklistsError) throw checklistsError;

  const checklists = (checklistRows ?? []).map(mapChecklistRow);
  if (checklists.length === 0) return checklists;

  const { data: itemRows, error: itemsError } = await supabase
    .from("checklist_items")
    .select("*")
    .in(
      "checklist_id",
      checklists.map((checklist) => checklist.id)
    )
    .order("order_index", { ascending: true });
  if (itemsError) throw itemsError;

  const itemsByChecklistId = new Map<string, ChecklistItem[]>();
  for (const row of itemRows ?? []) {
    const item = mapItemRow(row);
    const items = itemsByChecklistId.get(item.checklistId) ?? [];
    items.push(item);
    itemsByChecklistId.set(item.checklistId, items);
  }

  return checklists.map((checklist) => ({
    ...checklist,
    items: itemsByChecklistId.get(checklist.id) ?? [],
  }));
}

export async function createChecklist(
  supabase: TypedClient,
  taskId: string,
  title: string,
  orderIndex: number
): Promise<Checklist> {
  const { data, error } = await supabase
    .from("checklists")
    .insert({
      task_id: taskId,
      title,
      order_index: orderIndex,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapChecklistRow(data);
}

export async function deleteChecklist(supabase: TypedClient, checklistId: string): Promise<void> {
  const { error } = await supabase.from("checklists").delete().eq("id", checklistId);
  if (error) throw error;
}

export async function addChecklistItem(
  supabase: TypedClient,
  checklistId: string,
  label: string,
  orderIndex: number
): Promise<ChecklistItem> {
  const { data, error } = await supabase
    .from("checklist_items")
    .insert({
      checklist_id: checklistId,
      label,
      order_index: orderIndex,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapItemRow(data);
}

export async function toggleChecklistItem(supabase: TypedClient, itemId: string, isDone: boolean): Promise<void> {
  const { error } = await supabase.from("checklist_items").update({ is_done: isDone }).eq("id", itemId);
  if (error) throw error;
}

export async function deleteChecklistItem(supabase: TypedClient, itemId: string): Promise<void> {
  const { error } = await supabase.from("checklist_items").delete().eq("id", itemId);
  if (error) throw error;
}
