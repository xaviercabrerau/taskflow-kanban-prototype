import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface BoardHandle {
  tenantId: string;
  boardId: string;
  workspaceId: string;
  isOwner: boolean;
  userId: string;
}

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Columnas y semilla replican exactamente src/lib/storage.ts (versión localStorage)
// para que la primera carga se vea igual; a partir de ahí todo vive en Supabase.
const SEED_COLUMNS = [
  { key: "todo", label: "To Do", color: "--low", order_index: 0, is_done_state: false },
  { key: "progress", label: "En progreso", color: "--medium", order_index: 1, is_done_state: false },
  { key: "review", label: "Revisión", color: "--accent", order_index: 2, is_done_state: false },
  { key: "done", label: "Done", color: "--muted", order_index: 3, is_done_state: true },
] as const;

function seedTasksByColumn() {
  return {
    todo: [
      { title: "Login SSO con Google Workspace", priority: "high", assignee_name: "Ana", tag: "backend", start_date: iso(2), due_date: iso(5) },
      { title: "Migrar base de datos a Postgres 16", priority: "high", assignee_name: "Luis", tag: "infra", start_date: iso(-4), due_date: iso(-2) },
      { title: "Documentar endpoints del API público", priority: "low", assignee_name: "Ana", tag: "docs", start_date: iso(8), due_date: iso(11) },
      { title: "Configurar pipeline de CI/CD", priority: "medium", assignee_name: "Luis", tag: "devops", start_date: iso(4), due_date: iso(7) },
    ],
    progress: [
      { title: "Refactor de capa de servicios API", priority: "medium", assignee_name: "Luis", tag: "urgent", start_date: iso(0), due_date: iso(3) },
      { title: "Dashboard de métricas por sprint", priority: "medium", assignee_name: "Ana", tag: "frontend", start_date: iso(2), due_date: iso(6) },
      { title: "Integración saliente con Slack", priority: "low", assignee_name: "Luis", tag: "integraciones", start_date: iso(6), due_date: iso(9) },
    ],
    review: [
      { title: "Fix alineación de footer", priority: "low", assignee_name: "Ana", tag: "ui", due_date: null },
      { title: "Validar matriz RBAC en QA", priority: "high", assignee_name: "Luis", tag: "seguridad", start_date: iso(1), due_date: iso(4) },
    ],
    done: [
      { title: "Setup inicial del repositorio", priority: "low", assignee_name: "Luis", tag: "infra", due_date: iso(-6) },
      { title: "Definir esquema de autenticación", priority: "low", assignee_name: "Ana", tag: "backend", due_date: iso(-4) },
      { title: "Wireframes de vista Tabla", priority: "low", assignee_name: "Ana", tag: "ui", due_date: iso(-5) },
    ],
  } as const;
}

async function findOrCreateOrganization(
  supabase: TypedClient,
  userId: string,
  email: string
): Promise<{ tenantId: string; isOwner: boolean }> {
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, org_role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (membership) return { tenantId: membership.organization_id, isOwner: membership.org_role === "owner" };

  const slugBase = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-") || "org";
  const slug = `${slugBase}-${userId.slice(0, 8)}`;
  // RPC atómica (security definer): crea la org y la membresía de owner en la
  // misma transacción — ver migración m8_atomic_org_creation_and_fix_org_update_policy.
  const { data: org, error: orgError } = await supabase.rpc("create_organization", {
    org_name: `Organización de ${email}`,
    org_slug: slug,
  });
  if (orgError) throw orgError;

  return { tenantId: org.id, isOwner: true };
}

async function findOrCreateBoard(supabase: TypedClient, tenantId: string): Promise<{ boardId: string; workspaceId: string }> {
  const { data: existingBoard } = await supabase
    .from("boards")
    .select("id, workspace_id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  if (existingBoard) return { boardId: existingBoard.id, workspaceId: existingBoard.workspace_id };

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({ tenant_id: tenantId, name: "General", icon: "📋", color: "--accent" })
    .select("id")
    .single();
  if (workspaceError) throw workspaceError;

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .insert({ tenant_id: tenantId, workspace_id: workspace.id, name: "Prototipo Kanban" })
    .select("id")
    .single();
  if (boardError) throw boardError;

  const { data: columns, error: columnsError } = await supabase
    .from("board_columns")
    .insert(SEED_COLUMNS.map((c) => ({ ...c, board_id: board.id })))
    .select("id, key");
  if (columnsError) throw columnsError;

  const columnIdByKey = Object.fromEntries(columns.map((c) => [c.key, c.id]));
  const seed = seedTasksByColumn();
  const rows = (Object.keys(seed) as Array<keyof typeof seed>).flatMap((colKey, colIdx) =>
    seed[colKey].map((t, i) => ({
      ...t,
      tenant_id: tenantId,
      board_id: board.id,
      column_id: columnIdByKey[colKey],
      position: colIdx * 1000 + i,
    }))
  );
  const { error: tasksError } = await supabase.from("tasks").insert(rows);
  if (tasksError) throw tasksError;

  return { boardId: board.id, workspaceId: workspace.id };
}

export interface WorkspaceSummary {
  workspaceId: string;
  boardId: string;
  name: string;
  icon: string | null;
}

// Lista las áreas de trabajo (workspace + su board, invariante 1:1 actual)
// de la organización, para el selector de workspace y el flujo de creación
// de nuevas áreas desde plantilla.
export async function listWorkspaces(supabase: TypedClient, tenantId: string): Promise<WorkspaceSummary[]> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, icon, boards(id)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((w) => Array.isArray(w.boards) && w.boards.length > 0)
    .map((w) => ({ workspaceId: w.id, boardId: w.boards[0].id, name: w.name, icon: w.icon }));
}

// Usado por el botón "Reset": borra las tareas del board y reinserta la semilla
// original, sin tocar columnas/organización/workspace ya existentes.
export async function reseedBoard(supabase: TypedClient, board: BoardHandle): Promise<void> {
  const { error: deleteError } = await supabase.from("tasks").delete().eq("board_id", board.boardId);
  if (deleteError) throw deleteError;

  const { data: columns, error: columnsError } = await supabase
    .from("board_columns")
    .select("id, key")
    .eq("board_id", board.boardId);
  if (columnsError) throw columnsError;

  const columnIdByKey = Object.fromEntries(columns.map((c) => [c.key, c.id]));
  const seed = seedTasksByColumn();
  const rows = (Object.keys(seed) as Array<keyof typeof seed>).flatMap((colKey, colIdx) =>
    seed[colKey].map((t, i) => ({
      ...t,
      tenant_id: board.tenantId,
      board_id: board.boardId,
      column_id: columnIdByKey[colKey],
      position: colIdx * 1000 + i,
    }))
  );
  const { error: tasksError } = await supabase.from("tasks").insert(rows);
  if (tasksError) throw tasksError;
}

// Idempotente: la primera vez crea organización/workspace/board/columnas + tareas
// semilla para el usuario autenticado; en cargas siguientes solo resuelve los ids.
export async function ensureBootstrap(supabase: TypedClient): Promise<BoardHandle> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("No hay usuario autenticado");

  const { tenantId, isOwner } = await findOrCreateOrganization(
    supabase,
    userData.user.id,
    userData.user.email ?? "usuario"
  );
  const { boardId, workspaceId } = await findOrCreateBoard(supabase, tenantId);
  return { tenantId, boardId, workspaceId, isOwner, userId: userData.user.id };
}
