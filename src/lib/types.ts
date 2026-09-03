export type Priority = "urgent" | "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  assignee: string;
  assigneeUserId?: string | null; // FK real a auth.users; null si es texto libre sin vincular (ver migración add_task_assignee_user_id_with_sync)
  tag?: string;
  startDate?: string; // ISO date "YYYY-MM-DD", used by the Gantt view
  dueDate?: string; // ISO date "YYYY-MM-DD"
  commentCount?: number;
  attachmentCount?: number;
  createdAt?: string; // ISO timestamp, para métricas de antigüedad/cycle time
  parentTaskId?: string | null; // subtarea de otra tarea; null/undefined = tarea de nivel superior
}

export function priorityLabel(p: Priority): string {
  return p === "urgent" ? "Urgente" : p === "high" ? "Alta" : p === "medium" ? "Media" : "Baja";
}

export interface ColumnData {
  id: string;
  title: string;
  colorVar: string; // CSS variable name used for the column dot, e.g. "--low"
  taskIds: string[];
  isDoneState: boolean;
}

export interface BoardState {
  tasks: Record<string, Task>;
  columns: ColumnData[];
}

export const ASSIGNEE_COLORS: Record<string, string> = {
  Ana: "#6E56CF",
  Luis: "#C2255C",
};

export function assigneeColor(name: string): string {
  return ASSIGNEE_COLORS[name] ?? "#4C7A6B";
}

export function assigneeInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// "YYYY-MM-DD" siempre representa una fecha calendario, no un instante UTC.
// new Date("YYYY-MM-DD") lo interpreta como medianoche UTC; leerlo luego con
// getters locales (getDate/getMonth/toLocaleDateString) lo desplaza un día
// en zonas con offset negativo. Construir la fecha en el constructor local
// (y, m, d) evita ese corrimiento.
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isOverdue(dueDate: string | undefined): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseDateOnly(dueDate);
  due.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

export function formatDue(dueDate: string | undefined): string {
  if (!dueDate) return "—";
  const d = parseDateOnly(dueDate);
  return d.toLocaleDateString("es-EC", { day: "numeric", month: "short" }).replace(".", "");
}

export interface DueBadge {
  label: string;
  variant: "overdue" | "soon";
}

// "Vence pronto" = hoy o mañana, todavía no vencida. Igual umbral que Trello
// usa para su badge amarillo en la tarjeta.
export function dueBadge(dueDate: string | undefined): DueBadge | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseDateOnly(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { label: "Vencida", variant: "overdue" };
  if (diffDays <= 1) return { label: "Vence pronto", variant: "soon" };
  return null;
}
