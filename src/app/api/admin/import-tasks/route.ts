import * as XLSX from "xlsx";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { validateTaskRow, type RawImportRow, type RowError } from "@/lib/import/task-row";

const MAX_ROWS = 500;

type ParsedTaskRowResult = NonNullable<ReturnType<typeof validateTaskRow>["row"]>;

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, org_role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) {
    return Response.json({ error: membershipError.message }, { status: 500 });
  }
  if (!membership || membership.org_role !== "owner") {
    return Response.json(
      { error: "Solo el propietario de la organización puede importar tareas." },
      { status: 403 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Cuerpo de la petición inválido." }, { status: 400 });
  }

  const file = form.get("file");
  const boardId = form.get("boardId");
  if (!(file instanceof File) || typeof boardId !== "string" || !boardId) {
    return Response.json({ error: "file y boardId son requeridos." }, { status: 400 });
  }

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .select("id, tenant_id")
    .eq("id", boardId)
    .maybeSingle();
  if (boardError) {
    return Response.json({ error: boardError.message }, { status: 500 });
  }
  if (!board || board.tenant_id !== membership.organization_id) {
    return Response.json({ error: "Ese tablero no pertenece a tu organización." }, { status: 403 });
  }

  let rawRows: RawImportRow[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    rawRows = XLSX.utils.sheet_to_json<RawImportRow>(sheet, { defval: "" });
  } catch {
    return Response.json(
      { error: "No se pudo leer el archivo. Verifica que sea .xlsx, .xls o .csv." },
      { status: 400 }
    );
  }

  if (rawRows.length > MAX_ROWS) {
    return Response.json({ error: "Máximo 500 filas por archivo." }, { status: 400 });
  }

  const { data: columns, error: columnsError } = await supabase
    .from("board_columns")
    .select("id, label")
    .eq("board_id", boardId);
  if (columnsError) {
    return Response.json({ error: columnsError.message }, { status: 500 });
  }
  const columnLabelToId = new Map(
    (columns ?? []).map((c) => [c.label.trim().toLowerCase(), c.id])
  );

  const validRows: ParsedTaskRowResult[] = [];
  const errors: RowError[] = [];
  rawRows.forEach((raw, index) => {
    const result = validateTaskRow(raw, index + 1, columnLabelToId);
    if (result.error) errors.push(result.error);
    else if (result.row) validRows.push(result.row);
  });

  if (validRows.length === 0) {
    return Response.json({ created: 0, errors });
  }

  // Posición de inserción: para cada columna destino, se parte del máximo
  // actual y se incrementa por cada fila válida en el orden del archivo —
  // mismo criterio conceptual que nextPosition() en board-repo.ts.
  const nextPositionByColumn = new Map<string, number>();
  for (const columnId of new Set(validRows.map((r) => r.columnId))) {
    const { data: maxRow } = await supabase
      .from("tasks")
      .select("position")
      .eq("column_id", columnId)
      .order("position", { ascending: false })
      .limit(1);
    const currentMax = maxRow?.[0]?.position ?? 0;
    nextPositionByColumn.set(columnId, currentMax);
  }

  const insertPayload = validRows.map((row) => {
    const nextPosition = (nextPositionByColumn.get(row.columnId) ?? 0) + 1;
    nextPositionByColumn.set(row.columnId, nextPosition);
    return {
      tenant_id: membership.organization_id,
      board_id: boardId,
      column_id: row.columnId,
      title: row.title,
      priority: row.priority,
      assignee_name: row.assignee ?? null,
      tag: row.tag ?? null,
      start_date: row.startDate ?? null,
      due_date: row.dueDate ?? null,
      position: nextPosition,
    };
  });

  const { error: insertError } = await supabase.from("tasks").insert(insertPayload);
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  return Response.json({ created: validRows.length, errors });
}
