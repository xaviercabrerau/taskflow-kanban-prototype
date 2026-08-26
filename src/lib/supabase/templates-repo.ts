import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface TemplateColumn {
  key: string;
  label: string;
  color: string | null;
  order_index: number;
  is_done_state: boolean;
}

export interface BoardTemplate {
  id: string;
  name: string;
  defaultColumns: TemplateColumn[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isTemplateColumn(x: unknown): x is TemplateColumn {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.key === "string" &&
    typeof c.label === "string" &&
    (typeof c.color === "string" || c.color === null) &&
    typeof c.order_index === "number" &&
    typeof c.is_done_state === "boolean"
  );
}

function toTemplateColumns(value: unknown): TemplateColumn[] {
  return Array.isArray(value) ? value.filter(isTemplateColumn) : [];
}

// Plantillas globales (tenant_id null) + las propias de la organización.
export async function fetchBoardTemplates(supabase: TypedClient, tenantId: string): Promise<BoardTemplate[]> {
  if (!UUID_RE.test(tenantId)) throw new Error("tenantId inválido.");
  const { data, error } = await supabase
    .from("board_templates")
    .select("id, name, default_columns")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    defaultColumns: toTemplateColumns(row.default_columns),
  }));
}

export interface MarketplaceTemplate {
  id: string;
  name: string;
  description: string | null;
  defaultColumns: TemplateColumn[];
  installCount: number;
  ownerTenantId: string | null;
}

// Plantillas públicas de cualquier organización (marketplace interno).
export async function fetchMarketplaceTemplates(supabase: TypedClient): Promise<MarketplaceTemplate[]> {
  const { data, error } = await supabase
    .from("board_templates")
    .select("id, name, description, default_columns, install_count, tenant_id")
    .eq("is_public", true)
    .order("install_count", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    defaultColumns: toTemplateColumns(row.default_columns),
    installCount: row.install_count,
    ownerTenantId: row.tenant_id,
  }));
}

export interface OwnTemplate {
  id: string;
  name: string;
  isPublic: boolean;
  installCount: number;
}

// Plantillas personalizadas creadas por la propia organización (publicadas o no).
export async function fetchOwnTemplates(supabase: TypedClient, tenantId: string): Promise<OwnTemplate[]> {
  const { data, error } = await supabase
    .from("board_templates")
    .select("id, name, is_public, install_count")
    .eq("tenant_id", tenantId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isPublic: row.is_public,
    installCount: row.install_count,
  }));
}

// Publica el board actual de la organización como una plantilla nueva,
// reutilizable por cualquier organización desde el marketplace.
export async function publishBoardAsTemplate(
  supabase: TypedClient,
  tenantId: string,
  boardId: string,
  name: string,
  description: string,
  userId: string
): Promise<void> {
  const { data: columns, error: columnsError } = await supabase
    .from("board_columns")
    .select("key, label, color, order_index, is_done_state")
    .eq("board_id", boardId)
    .order("order_index");
  if (columnsError) throw columnsError;

  const { error: insertError } = await supabase.from("board_templates").insert({
    tenant_id: tenantId,
    name,
    description,
    default_columns: columns ?? [],
    is_public: true,
    published_by: userId,
  });
  if (insertError) throw insertError;
}

export async function setTemplatePublished(supabase: TypedClient, templateId: string, isPublic: boolean): Promise<void> {
  const { error } = await supabase.from("board_templates").update({ is_public: isPublic }).eq("id", templateId);
  if (error) throw error;
}

// Vía RPC (SECURITY DEFINER): cualquier miembro autenticado puede incrementar
// el contador de una plantilla pública, sin necesitar permisos de escritura
// sobre board_templates de una organización que no es la suya.
async function incrementInstallCount(supabase: TypedClient, templateId: string): Promise<void> {
  const { error } = await supabase.rpc("increment_template_install_count", { p_template_id: templateId });
  if (error) throw error;
}

// Crea un workspace + su board + columnas iniciales a partir de una
// plantilla. Mismo patrón que findOrCreateBoard en bootstrap.ts.
export async function createWorkspaceFromTemplate(
  supabase: TypedClient,
  tenantId: string,
  name: string,
  icon: string,
  template: BoardTemplate
): Promise<{ workspaceId: string; boardId: string }> {
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({ tenant_id: tenantId, name, icon, color: "--accent" })
    .select("id")
    .single();
  if (workspaceError) throw workspaceError;

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .insert({ tenant_id: tenantId, workspace_id: workspace.id, name })
    .select("id")
    .single();
  if (boardError) throw boardError;

  const { error: columnsError } = await supabase
    .from("board_columns")
    .insert(template.defaultColumns.map((c) => ({ ...c, board_id: board.id })));
  if (columnsError) throw columnsError;

  // No-op para plantillas propias/no públicas: el RPC solo incrementa
  // filas con is_public = true.
  // No fatal: el workspace/board/columns ya existen; un fallo aquí no debe
  // revertir la creación, solo perder el incremento del contador.
  try {
    await incrementInstallCount(supabase, template.id);
  } catch (err) {
    console.error("incrementInstallCount failed", err);
  }

  return { workspaceId: workspace.id, boardId: board.id };
}
