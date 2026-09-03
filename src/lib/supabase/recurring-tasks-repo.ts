import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { Priority } from "@/lib/types";

type TypedClient = SupabaseClient<Database>;

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurringTaskTemplate {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  assigneeUserId: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  nextRunAt: string;
  lastRunAt: string | null;
  active: boolean;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["recurring_task_templates"]["Row"]): RecurringTaskTemplate {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    priority: row.priority as Priority,
    assigneeUserId: row.assignee_user_id,
    frequency: row.frequency as RecurrenceFrequency,
    intervalCount: row.interval_count,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    active: row.active,
    createdAt: row.created_at,
  };
}

export async function fetchRecurringTaskTemplates(supabase: TypedClient, boardId: string): Promise<RecurringTaskTemplate[]> {
  const { data, error } = await supabase
    .from("recurring_task_templates")
    .select("*")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export interface CreateRecurringTaskInput {
  columnId: string;
  title: string;
  description?: string | null;
  priority: Priority;
  assigneeUserId?: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  nextRunAt: string;
}

export async function createRecurringTaskTemplate(
  supabase: TypedClient,
  tenantId: string,
  boardId: string,
  input: CreateRecurringTaskInput,
  createdBy: string | null
): Promise<RecurringTaskTemplate> {
  const { data, error } = await supabase
    .from("recurring_task_templates")
    .insert({
      tenant_id: tenantId,
      board_id: boardId,
      column_id: input.columnId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      assignee_user_id: input.assigneeUserId ?? null,
      frequency: input.frequency,
      interval_count: input.intervalCount,
      day_of_week: input.dayOfWeek ?? null,
      day_of_month: input.dayOfMonth ?? null,
      next_run_at: input.nextRunAt,
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function toggleRecurringTaskTemplate(supabase: TypedClient, id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("recurring_task_templates").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deleteRecurringTaskTemplate(supabase: TypedClient, id: string): Promise<void> {
  const { error } = await supabase.from("recurring_task_templates").delete().eq("id", id);
  if (error) throw error;
}
