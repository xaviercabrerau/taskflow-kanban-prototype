import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface TaskActivity {
  id: string;
  taskId: string;
  actorId: string | null;
  action: string;
  metadata: Json;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["activity_log"]["Row"]): TaskActivity {
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    action: row.action,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

// RLS (activity_log_select) ya limita a miembros de la organización de la
// tarea; solo lectura — no hay insert/update/delete desde el cliente
// (append-only vía el trigger log_task_activity).
export async function fetchActivity(supabase: TypedClient, taskId: string): Promise<TaskActivity[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

// Traduce action + metadata a un texto legible en español. resolveColumnName
// es opcional (p.ej. state.columns.find(...).title) para mostrar el nombre de
// la columna en vez de su UUID; si no se pasa, o no se encuentra, se muestra
// el UUID crudo (funcional aunque no sea perfecto).
export function describeActivity(
  activity: TaskActivity,
  resolveColumnName?: (columnId: string) => string | undefined
): string {
  const metadata = (activity.metadata ?? {}) as Record<string, unknown>;

  switch (activity.action) {
    case "created":
      return `Se creó la tarea "${String(metadata.title ?? "")}"`;
    case "status_changed": {
      const from = metadata.from ? resolveColumnName?.(String(metadata.from)) ?? String(metadata.from) : "—";
      const to = metadata.to ? resolveColumnName?.(String(metadata.to)) ?? String(metadata.to) : "—";
      return `Cambió de estado: ${from} → ${to}`;
    }
    case "assigned": {
      const from = metadata.from ? String(metadata.from) : "sin asignar";
      const to = metadata.to ? String(metadata.to) : "sin asignar";
      return `Asignado cambiado de ${from} a ${to}`;
    }
    case "field_updated": {
      const field = String(metadata.field ?? "campo");
      const fieldLabel =
        field === "priority" ? "Prioridad" : field === "due_date" ? "Fecha de vencimiento" : field === "title" ? "Título" : field;
      const from = metadata.from != null ? String(metadata.from) : "—";
      const to = metadata.to != null ? String(metadata.to) : "—";
      return `${fieldLabel} cambiada de ${from} a ${to}`;
    }
    default:
      return activity.action;
  }
}
