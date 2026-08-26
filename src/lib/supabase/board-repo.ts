import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardState, ColumnData, Task } from "@/lib/types";
import type { Database } from "./database.types";
import type { BoardHandle } from "./bootstrap";

type TypedClient = SupabaseClient<Database>;
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

export interface FetchResult {
  state: BoardState;
  positions: Record<string, number>;
}

// Postgres/PostgREST devuelven timestamptz como ISO completo (ej.
// "2026-08-11T00:00:00+00:00"); el resto de la app (input type="date",
// comparaciones de string en CalendarView) espera "YYYY-MM-DD" exacto.
function toDateOnly(value: string | null): string | undefined {
  return value ? value.slice(0, 10) : undefined;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority as Task["priority"],
    assignee: row.assignee_name ?? "Sin asignar",
    assigneeUserId: row.assignee_user_id,
    createdAt: row.created_at,
    tag: row.tag ?? undefined,
    startDate: toDateOnly(row.start_date),
    dueDate: toDateOnly(row.due_date),
  };
}

export async function fetchBoardState(supabase: TypedClient, board: BoardHandle): Promise<FetchResult> {
  const [{ data: columnRows, error: colError }, { data: taskRows, error: taskError }] = await Promise.all([
    supabase.from("board_columns").select("*").eq("board_id", board.boardId).order("order_index"),
    supabase.from("tasks").select("*").eq("board_id", board.boardId).order("position"),
  ]);
  if (colError) throw colError;
  if (taskError) throw taskError;

  const tasks: Record<string, Task> = {};
  const positions: Record<string, number> = {};
  const taskIdsByColumn: Record<string, string[]> = {};
  for (const col of columnRows ?? []) taskIdsByColumn[col.id] = [];
  for (const row of taskRows ?? []) {
    tasks[row.id] = rowToTask(row);
    positions[row.id] = row.position;
    (taskIdsByColumn[row.column_id] ??= []).push(row.id);
  }

  const columns = (columnRows ?? []).map((col) => ({
    id: col.id,
    title: col.label,
    colorVar: col.color ?? "--muted",
    taskIds: taskIdsByColumn[col.id] ?? [],
    isDoneState: col.is_done_state ?? false,
  }));

  return { state: { tasks, columns }, positions };
}

// Fractional indexing: coloca la tarea entre sus dos vecinos en la lista destino
// sin tener que renumerar el resto de la columna.
export function nextPosition(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

export async function insertTask(
  supabase: TypedClient,
  board: BoardHandle,
  columnId: string,
  task: Task,
  position: number
): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: board.tenantId,
      board_id: board.boardId,
      column_id: columnId,
      title: task.title,
      priority: task.priority,
      assignee_name: task.assignee || null,
      assignee_user_id: task.assigneeUserId ?? null,
      tag: task.tag ?? null,
      start_date: task.startDate ?? null,
      due_date: task.dueDate ?? null,
      position,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateTaskFields(supabase: TypedClient, task: Task): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      title: task.title,
      priority: task.priority,
      assignee_name: task.assignee || null,
      assignee_user_id: task.assigneeUserId ?? null,
      tag: task.tag ?? null,
      start_date: task.startDate ?? null,
      due_date: task.dueDate ?? null,
    })
    .eq("id", task.id);
  if (error) throw error;
}

export async function moveTaskRemote(
  supabase: TypedClient,
  taskId: string,
  columnId: string,
  position: number
): Promise<void> {
  const { error } = await supabase.from("tasks").update({ column_id: columnId, position }).eq("id", taskId);
  if (error) throw error;
}

export async function deleteTaskRemote(supabase: TypedClient, taskId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}

// `key` es un identificador interno slugificado, no se muestra ni se usa
// para búsquedas en ningún RPC (mcp_move_task, automatizaciones, etc. usan
// el `label` visible) — solo necesita ser razonablemente único dentro del
// board.
function slugifyColumnKey(label: string): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "col";
  return `${base}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function insertColumn(
  supabase: TypedClient,
  boardId: string,
  label: string,
  colorVar: string,
  orderIndex: number
): Promise<ColumnData> {
  const { data, error } = await supabase
    .from("board_columns")
    .insert({
      board_id: boardId,
      key: slugifyColumnKey(label),
      label,
      color: colorVar,
      order_index: orderIndex,
      is_done_state: false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.label,
    colorVar: data.color ?? colorVar,
    taskIds: [],
    isDoneState: data.is_done_state ?? false,
  };
}
