import { BoardState, Task } from "./types";

const STORAGE_KEY = "taskflow-board-v1";

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function seedTasks(): Record<string, Task> {
  const tasks: Task[] = [
    { id: "t1", title: "Login SSO con Google Workspace", priority: "high", assignee: "Ana", tag: "backend", startDate: iso(2), dueDate: iso(5), attachmentCount: 2 },
    { id: "t2", title: "Migrar base de datos a Postgres 16", priority: "high", assignee: "Luis", tag: "infra", startDate: iso(-4), dueDate: iso(-2), commentCount: 1 },
    { id: "t3", title: "Documentar endpoints del API público", priority: "low", assignee: "Ana", tag: "docs", startDate: iso(8), dueDate: iso(11) },
    { id: "t4", title: "Configurar pipeline de CI/CD", priority: "medium", assignee: "Luis", tag: "devops", startDate: iso(4), dueDate: iso(7) },
    { id: "t5", title: "Refactor de capa de servicios API", priority: "medium", assignee: "Luis", tag: "urgent", startDate: iso(0), dueDate: iso(3), commentCount: 3 },
    { id: "t6", title: "Dashboard de métricas por sprint", priority: "medium", assignee: "Ana", tag: "frontend", startDate: iso(2), dueDate: iso(6), attachmentCount: 1 },
    { id: "t7", title: "Integración saliente con Slack", priority: "low", assignee: "Luis", tag: "integraciones", startDate: iso(6), dueDate: iso(9) },
    { id: "t8", title: "Fix alineación de footer", priority: "low", assignee: "Ana", tag: "ui" },
    { id: "t9", title: "Validar matriz RBAC en QA", priority: "high", assignee: "Luis", tag: "seguridad", startDate: iso(1), dueDate: iso(4), commentCount: 2 },
    { id: "t10", title: "Setup inicial del repositorio", priority: "low", assignee: "Luis", tag: "infra", dueDate: iso(-6) },
    { id: "t11", title: "Definir esquema de autenticación", priority: "low", assignee: "Ana", tag: "backend", dueDate: iso(-4) },
    { id: "t12", title: "Wireframes de vista Tabla", priority: "low", assignee: "Ana", tag: "ui", dueDate: iso(-5) },
  ];
  return Object.fromEntries(tasks.map((t) => [t.id, t]));
}

export function getInitialState(): BoardState {
  return {
    tasks: seedTasks(),
    columns: [
      { id: "todo", title: "To Do", colorVar: "--low", taskIds: ["t1", "t2", "t3", "t4"], isDoneState: false },
      { id: "progress", title: "En progreso", colorVar: "--medium", taskIds: ["t5", "t6", "t7"], isDoneState: false },
      { id: "review", title: "Revisión", colorVar: "--accent", taskIds: ["t8", "t9"], isDoneState: false },
      { id: "done", title: "Done", colorVar: "--muted", taskIds: ["t10", "t11", "t12"], isDoneState: true },
    ],
  };
}

export function loadState(): BoardState {
  if (typeof window === "undefined") return getInitialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getInitialState();
    const parsed = JSON.parse(raw) as BoardState;
    if (!parsed.tasks || !parsed.columns) return getInitialState();
    return parsed;
  } catch {
    return getInitialState();
  }
}

export function saveState(state: BoardState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): BoardState {
  const fresh = getInitialState();
  saveState(fresh);
  return fresh;
}
