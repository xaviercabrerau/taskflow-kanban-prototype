import * as XLSX from "xlsx";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { IMPORT_HEADERS } from "@/lib/import/task-row";

// Plantilla estática — no depende de datos de ninguna organización, solo
// requiere una sesión válida para no quedar completamente pública.
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const headers = [...IMPORT_HEADERS];
  const exampleRow = [
    "Enviar propuesta al cliente",
    "To Do",
    "Alta",
    "Ana Torres",
    "ventas",
    "2026-09-10",
    "2026-09-15",
  ];

  const sheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tareas");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-importar-tareas.xlsx"',
    },
  });
}
