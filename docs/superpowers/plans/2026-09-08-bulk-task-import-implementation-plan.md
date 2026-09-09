# Importación masiva de tareas — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development
> o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos
> usan checkboxes (`- [ ]`) para seguimiento.

**Meta:** implementar la importación masiva de tareas descrita en
`docs/superpowers/specs/2026-09-08-bulk-task-import-design.md` — plantilla
descargable, subida de `.xlsx/.xls/.csv`, validación fila por fila con
importación parcial, página nueva en Administración.

**Arquitectura:** lógica de validación en un módulo puro y testeable
(`src/lib/import/task-row.ts`), consumido por dos rutas de API
(`GET .../template`, `POST /api/admin/import-tasks`) y un panel de React
(`ImportTasksPanel.tsx`) + su página admin.

**Stack:** Next.js 16 (App Router) + TypeScript + Supabase + librería
`xlsx` (SheetJS) nueva.

## Restricciones globales

- Cada tarea termina con `npx tsc --noEmit` + `npm run build` +
  `npm test -- --silent` (todos los tests existentes en verde, más los
  nuevos) antes de commitear.
- Commits específicos (`git add <archivos>`, nunca `-A`), mensaje +
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Verificar en el navegador antes de dar el trabajo por terminado — no
  basta con que compile y los tests pasen.

---

### Tarea 1: Instalar `xlsx` y crear el módulo de validación de filas

**Archivos:**
- Modificar: `package.json` (nueva dependencia)
- Crear: `src/lib/import/task-row.ts`
- Test: `src/lib/import/__tests__/task-row.test.ts`

**Interfaces (lo que producen para las tareas siguientes):**
```typescript
export type ParsedPriority = "low" | "medium" | "high" | "urgent";

export interface ParsedTaskRow {
  title: string;
  columnId: string;
  priority: ParsedPriority;
  assignee?: string;
  tag?: string;
  startDate?: string; // "YYYY-MM-DD"
  dueDate?: string; // "YYYY-MM-DD"
}

export interface RowError {
  row: number;
  reason: string;
}

export type RawImportRow = Record<string, unknown>;

export function excelSerialToISODate(serial: number): string | null;

export function validateTaskRow(
  raw: RawImportRow,
  rowNumber: number,
  columnLabelToId: Map<string, string>
): { row?: ParsedTaskRow; error?: RowError };
```

- [ ] **Paso 1: Instalar la dependencia**

  ```bash
  npm install xlsx
  ```

- [ ] **Paso 2: Escribir el test que falla primero**

  ```typescript
  // src/lib/import/__tests__/task-row.test.ts
  import { describe, it, expect } from '@jest/globals';
  import { validateTaskRow, excelSerialToISODate } from '../task-row';

  describe('excelSerialToISODate', () => {
    it('converts a known Excel serial date to YYYY-MM-DD', () => {
      // 45901 = 2025-09-10 in Excel's 1900 date system
      expect(excelSerialToISODate(45901)).toBe('2025-09-10');
    });

    it('returns null for an invalid serial number', () => {
      expect(excelSerialToISODate(NaN)).toBeNull();
    });
  });

  describe('validateTaskRow', () => {
    const columnMap = new Map([
      ['to do', 'col-todo-id'],
      ['en progreso', 'col-progress-id'],
    ]);

    it('parses a fully valid row', () => {
      const result = validateTaskRow(
        {
          'Título': 'Enviar propuesta',
          'Estado': 'To Do',
          'Prioridad': 'Alta',
          'Asignado': 'Ana Torres',
          'Etiqueta': 'ventas',
          'Fecha inicio': '2026-09-10',
          'Fecha vencimiento': '2026-09-15',
        },
        1,
        columnMap
      );
      expect(result.error).toBeUndefined();
      expect(result.row).toEqual({
        title: 'Enviar propuesta',
        columnId: 'col-todo-id',
        priority: 'high',
        assignee: 'Ana Torres',
        tag: 'ventas',
        startDate: '2026-09-10',
        dueDate: '2026-09-15',
      });
    });

    it('defaults priority to medium when empty', () => {
      const result = validateTaskRow(
        { 'Título': 'Tarea sin prioridad', 'Estado': 'To Do' },
        2,
        columnMap
      );
      expect(result.error).toBeUndefined();
      expect(result.row?.priority).toBe('medium');
    });

    it('reports an error when Título is empty', () => {
      const result = validateTaskRow({ 'Título': '  ', 'Estado': 'To Do' }, 3, columnMap);
      expect(result.row).toBeUndefined();
      expect(result.error).toEqual({ row: 3, reason: 'Título es obligatorio' });
    });

    it('reports an error when Estado does not match any column', () => {
      const result = validateTaskRow(
        { 'Título': 'Tarea', 'Estado': 'Columna Inexistente' },
        4,
        columnMap
      );
      expect(result.error?.reason).toBe(
        'Estado "Columna Inexistente" no coincide con ninguna columna del tablero'
      );
    });

    it('reports an error when Prioridad is not recognized', () => {
      const result = validateTaskRow(
        { 'Título': 'Tarea', 'Estado': 'To Do', 'Prioridad': 'Crítica' },
        5,
        columnMap
      );
      expect(result.error?.reason).toBe(
        'Prioridad "Crítica" no reconocida (usa Baja/Media/Alta/Urgente)'
      );
    });

    it('reports an error when a date string is malformed', () => {
      const result = validateTaskRow(
        { 'Título': 'Tarea', 'Estado': 'To Do', 'Fecha inicio': '10/09/2026' },
        6,
        columnMap
      );
      expect(result.error?.reason).toBe(
        'Fecha inicio "10/09/2026" no tiene un formato válido (usa AAAA-MM-DD)'
      );
    });

    it('accepts an Excel serial number as a date', () => {
      const result = validateTaskRow(
        { 'Título': 'Tarea', 'Estado': 'To Do', 'Fecha inicio': 45901 },
        7,
        columnMap
      );
      expect(result.error).toBeUndefined();
      expect(result.row?.startDate).toBe('2025-09-10');
    });

    it('concatenates multiple errors on the same row with "; "', () => {
      const result = validateTaskRow({ 'Título': '', 'Estado': 'Nope' }, 8, columnMap);
      expect(result.error?.reason).toBe(
        'Título es obligatorio; Estado "Nope" no coincide con ninguna columna del tablero'
      );
    });
  });
  ```

- [ ] **Paso 3: Confirmar que el test falla**

  Run: `npm test -- task-row --silent`
  Expected: FAIL (el módulo `../task-row` todavía no existe)

- [ ] **Paso 4: Implementar el módulo**

  ```typescript
  // src/lib/import/task-row.ts

  export type ParsedPriority = "low" | "medium" | "high" | "urgent";

  export interface ParsedTaskRow {
    title: string;
    columnId: string;
    priority: ParsedPriority;
    assignee?: string;
    tag?: string;
    startDate?: string;
    dueDate?: string;
  }

  export interface RowError {
    row: number;
    reason: string;
  }

  export type RawImportRow = Record<string, unknown>;

  const PRIORITY_MAP: Record<string, ParsedPriority> = {
    baja: "low",
    media: "medium",
    alta: "high",
    urgente: "urgent",
  };

  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  // Excel/xlsx numeric dates cuentan días desde 1899-12-30 (el "bug" del
  // año 1900 de Excel está ya incorporado en este offset de 25569 días
  // hasta el epoch Unix de 1970-01-01).
  export function excelSerialToISODate(serial: number): string | null {
    if (!Number.isFinite(serial)) return null;
    const utcDays = Math.floor(serial - 25569);
    const utcMillis = utcDays * 86400 * 1000;
    const date = new Date(utcMillis);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  function readText(raw: RawImportRow, key: string): string {
    const value = raw[key];
    if (value === undefined || value === null) return "";
    return String(value).trim();
  }

  function normalizeDateField(
    raw: RawImportRow,
    key: string,
    errors: string[]
  ): string | undefined {
    const value = raw[key];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "number") {
      const iso = excelSerialToISODate(value);
      if (!iso) {
        errors.push(`${key} "${value}" no tiene un formato válido (usa AAAA-MM-DD)`);
        return undefined;
      }
      return iso;
    }
    const str = String(value).trim();
    if (!DATE_REGEX.test(str)) {
      errors.push(`${key} "${str}" no tiene un formato válido (usa AAAA-MM-DD)`);
      return undefined;
    }
    return str;
  }

  export function validateTaskRow(
    raw: RawImportRow,
    rowNumber: number,
    columnLabelToId: Map<string, string>
  ): { row?: ParsedTaskRow; error?: RowError } {
    const errors: string[] = [];

    const title = readText(raw, "Título");
    if (!title) errors.push("Título es obligatorio");

    const estadoRaw = raw["Estado"];
    const estadoKey = readText(raw, "Estado").toLowerCase();
    const columnId = columnLabelToId.get(estadoKey);
    if (!estadoKey) {
      errors.push("Estado es obligatorio");
    } else if (!columnId) {
      errors.push(`Estado "${estadoRaw}" no coincide con ninguna columna del tablero`);
    }

    let priority: ParsedPriority = "medium";
    const priorityText = readText(raw, "Prioridad");
    if (priorityText) {
      const mapped = PRIORITY_MAP[priorityText.toLowerCase()];
      if (!mapped) {
        errors.push(`Prioridad "${priorityText}" no reconocida (usa Baja/Media/Alta/Urgente)`);
      } else {
        priority = mapped;
      }
    }

    const assignee = readText(raw, "Asignado") || undefined;
    const tag = readText(raw, "Etiqueta") || undefined;
    const startDate = normalizeDateField(raw, "Fecha inicio", errors);
    const dueDate = normalizeDateField(raw, "Fecha vencimiento", errors);

    if (errors.length > 0) {
      return { error: { row: rowNumber, reason: errors.join("; ") } };
    }

    return {
      row: { title, columnId: columnId!, priority, assignee, tag, startDate, dueDate },
    };
  }
  ```

- [ ] **Paso 5: Correr los tests y confirmar que pasan**

  Run: `npm test -- task-row --silent`
  Expected: PASS (9/9)

- [ ] **Paso 6: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 7: Commit**

  ```bash
  git add package.json package-lock.json src/lib/import/task-row.ts src/lib/import/__tests__/task-row.test.ts
  git commit -m "$(cat <<'EOF'
  feat: módulo de validación de filas para importar tareas

  Función pura validateTaskRow() — valida Título/Estado/Prioridad/fechas
  de una fila cruda (xlsx/csv ya parseado a objeto) contra el mapa de
  columnas del tablero destino. Primer paso de la importación masiva
  (docs/superpowers/specs/2026-09-08-bulk-task-import-design.md).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 2: Endpoint de plantilla descargable

**Archivos:**
- Crear: `src/app/api/admin/import-tasks/template/route.ts`

**Interfaces:**
- Consume: `xlsx` (`XLSX.utils.json_to_sheet`, `XLSX.utils.book_new`,
  `XLSX.write`).
- Produce: `GET` que responde con un archivo `.xlsx` binario.

- [ ] **Paso 1: Implementar la ruta**

  ```typescript
  // src/app/api/admin/import-tasks/template/route.ts
  import * as XLSX from "xlsx";
  import { createClient as createServerSupabase } from "@/lib/supabase/server";

  // Plantilla estática — no depende de datos de ninguna organización, solo
  // requiere una sesión válida para no quedar completamente pública.
  export async function GET() {
    const supabase = await createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const headers = ["Título", "Estado", "Prioridad", "Asignado", "Etiqueta", "Fecha inicio", "Fecha vencimiento"];
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

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="plantilla-importar-tareas.xlsx"',
      },
    });
  }
  ```

- [ ] **Paso 2: Verificar tipos y build**

  ```bash
  npx tsc --noEmit
  npm run build
  ```

- [ ] **Paso 3: Verificar manualmente**

  Con el server de dev corriendo y una sesión iniciada, visitar
  `http://localhost:3300/api/admin/import-tasks/template` en el
  navegador y confirmar que descarga un `.xlsx` que abre correctamente
  y tiene las 7 columnas + la fila de ejemplo.

- [ ] **Paso 4: Commit**

  ```bash
  git add src/app/api/admin/import-tasks/template/route.ts
  git commit -m "$(cat <<'EOF'
  feat: endpoint de plantilla descargable para importar tareas

  GET /api/admin/import-tasks/template genera un .xlsx con las 7
  cabeceras + una fila de ejemplo, on-the-fly con la librería xlsx.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 3: Endpoint de importación (`POST /api/admin/import-tasks`)

**Archivos:**
- Crear: `src/app/api/admin/import-tasks/route.ts`
- Test: `src/app/api/admin/import-tasks/__tests__/route.test.ts`

**Interfaces:**
- Consume: `validateTaskRow`, `RawImportRow`, `RowError` de
  `src/lib/import/task-row.ts` (Tarea 1).
- Produce: `POST` que recibe `multipart/form-data` (`file`, `boardId`)
  y responde `{ created: number, errors: RowError[] }`.

- [ ] **Paso 1: Escribir los tests que fallan primero**

  ```typescript
  // src/app/api/admin/import-tasks/__tests__/route.test.ts
  import { describe, it, expect, beforeEach, jest } from '@jest/globals';
  import * as XLSX from 'xlsx';

  jest.mock('@/lib/supabase/server', () => ({
    createClient: jest.fn(),
  }));

  import { POST as importTasks } from '../route';
  import { createClient } from '@/lib/supabase/server';

  function makeXlsxFile(rows: Record<string, unknown>[]): File {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Tareas");
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return new File([buffer], 'tareas.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  function makeFormDataRequest(file: File, boardId: string): Request {
    const form = new FormData();
    form.append('file', file);
    form.append('boardId', boardId);
    return new Request('http://localhost:3000/api/admin/import-tasks', {
      method: 'POST',
      body: form,
    });
  }

  describe('POST /api/admin/import-tasks', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase query builder mock
    let mockSupabase: any;

    beforeEach(() => {
      jest.clearAllMocks();
      mockSupabase = {
        auth: { getUser: jest.fn() },
        from: jest.fn(),
      };
      (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    });

    it('returns 401 without a session', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no') });
      const file = makeXlsxFile([{ 'Título': 'x', 'Estado': 'To Do' }]);
      const response = await importTasks(makeFormDataRequest(file, 'board-1'));
      expect(response.status).toBe(401);
    });

    it('returns 403 when the caller is not the org owner', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { organization_id: 'org-1', org_role: 'member' },
              error: null,
            }),
          };
        }
        return {};
      });
      const file = makeXlsxFile([{ 'Título': 'x', 'Estado': 'To Do' }]);
      const response = await importTasks(makeFormDataRequest(file, 'board-1'));
      expect(response.status).toBe(403);
    });

    it('creates valid rows and reports invalid ones, matching board columns', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
      const insertedRows: unknown[] = [];
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { organization_id: 'org-1', org_role: 'owner' },
              error: null,
            }),
          };
        }
        if (table === 'boards') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'board-1', tenant_id: 'org-1' },
              error: null,
            }),
          };
        }
        if (table === 'board_columns') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'col-todo', label: 'To Do' }],
              error: null,
            }),
          };
        }
        if (table === 'tasks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            insert: jest.fn().mockImplementation((rows: unknown[]) => {
              insertedRows.push(...rows);
              return Promise.resolve({ error: null });
            }),
          };
        }
        return {};
      });

      const file = makeXlsxFile([
        { 'Título': 'Tarea válida', 'Estado': 'To Do', 'Prioridad': 'Alta' },
        { 'Título': '', 'Estado': 'To Do' },
      ]);
      const response = await importTasks(makeFormDataRequest(file, 'board-1'));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.created).toBe(1);
      expect(json.errors).toEqual([{ row: 2, reason: 'Título es obligatorio' }]);
      expect(insertedRows).toHaveLength(1);
    });

    it('rejects a file with more than 500 data rows', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { organization_id: 'org-1', org_role: 'owner' },
              error: null,
            }),
          };
        }
        if (table === 'boards') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'board-1', tenant_id: 'org-1' },
              error: null,
            }),
          };
        }
        return {};
      });

      const rows = Array.from({ length: 501 }, (_, i) => ({ 'Título': `Tarea ${i}`, 'Estado': 'To Do' }));
      const file = makeXlsxFile(rows);
      const response = await importTasks(makeFormDataRequest(file, 'board-1'));
      const json = await response.json();
      expect(response.status).toBe(400);
      expect(json.error).toBe('Máximo 500 filas por archivo.');
    });
  });
  ```

- [ ] **Paso 2: Confirmar que los tests fallan**

  Run: `npm test -- import-tasks --silent`
  Expected: FAIL (la ruta todavía no existe)

- [ ] **Paso 3: Implementar la ruta**

  ```typescript
  // src/app/api/admin/import-tasks/route.ts
  import * as XLSX from "xlsx";
  import { createClient as createServerSupabase } from "@/lib/supabase/server";
  import { validateTaskRow, type RawImportRow, type RowError } from "@/lib/import/task-row";

  const MAX_ROWS = 500;

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
  ```

  Nota de tipos: agregar en este mismo archivo (o importar de
  `task-row.ts` si se prefiere exportarlo desde ahí)
  `type ParsedTaskRowResult = NonNullable<ReturnType<typeof validateTaskRow>["row"]>;`
  antes de la función `POST`, para que `validRows` tenga un tipo
  concreto en vez de `any[]`.

- [ ] **Paso 4: Correr los tests y confirmar que pasan**

  Run: `npm test -- import-tasks --silent`
  Expected: PASS (4/4)

- [ ] **Paso 5: Verificar tipos, build y toda la suite**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 6: Commit**

  ```bash
  git add src/app/api/admin/import-tasks/route.ts src/app/api/admin/import-tasks/__tests__/route.test.ts
  git commit -m "$(cat <<'EOF'
  feat: endpoint POST /api/admin/import-tasks

  Parsea el archivo subido (xlsx/xls/csv) con la librería xlsx, valida
  cada fila con validateTaskRow(), inserta en lote las filas válidas
  (posición calculada por columna) y reporta las inválidas sin bloquear
  el resto — importación parcial, según el diseño aprobado. Límite de
  500 filas por archivo. Solo el owner de la organización puede usarlo.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 4: Panel de UI + página admin + link en el sidebar

**Archivos:**
- Crear: `src/components/ImportTasksPanel.tsx`
- Crear: `src/app/admin/importar-tareas/page.tsx`
- Modificar: el archivo donde vive la lista de links del sidebar admin
  (buscar primero: `grep -rn "Tareas recurrentes" src/app/admin` para
  ubicarlo exacto — no asumir el nombre del archivo).

**Interfaces:**
- Consume: `POST /api/admin/import-tasks` (Tarea 3),
  `GET /api/admin/import-tasks/template` (Tarea 2), `useBoard()` para
  `tenantId`/`supabase`.
- Necesita una función para listar los tableros de la organización — si
  ya existe un repo/hook para esto (buscar
  `grep -rn "from(\"boards\")" src/lib/supabase src/components`),
  reusarlo; si no, un fetch directo `supabase.from("boards").select("id, name")`
  dentro del propio componente es suficiente para este alcance (no
  crear un repo nuevo solo para esto).

- [ ] **Paso 1: Localizar el archivo del sidebar admin**

  ```bash
  grep -rn "Tareas recurrentes" src/app/admin
  ```

- [ ] **Paso 2: Implementar el panel**

  ```tsx
  // src/components/ImportTasksPanel.tsx
  "use client";

  import { useEffect, useState } from "react";
  import { useBoard } from "@/context/BoardContext";

  interface BoardOption {
    id: string;
    name: string;
  }

  interface ImportResult {
    created: number;
    errors: { row: number; reason: string }[];
  }

  export default function ImportTasksPanel() {
    const { supabase, tenantId } = useBoard();
    const [boards, setBoards] = useState<BoardOption[]>([]);
    const [boardId, setBoardId] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!tenantId) return;
      supabase
        .from("boards")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .then(({ data }) => setBoards(data ?? []));
    }, [supabase, tenantId]);

    async function handleImport(e: React.FormEvent) {
      e.preventDefault();
      if (!boardId || !file || importing) return;
      setImporting(true);
      setError(null);
      setResult(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("boardId", boardId);
        const res = await fetch("/api/admin/import-tasks", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "No se pudo importar el archivo.");
          return;
        }
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo importar el archivo.");
      } finally {
        setImporting(false);
      }
    }

    return (
      <div className="admin-panel">
        <div className="modal-head" style={{ padding: "0 0 12px" }}>
          <h2 style={{ fontSize: 15 }}>Importar tareas</h2>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 0 }}>
          Carga tareas en lote desde un archivo .xlsx, .xls o .csv. Descarga la
          plantilla para asegurarte de usar las cabeceras correctas.
        </p>
        <a href="/api/admin/import-tasks/template" className="btn" style={{ marginBottom: 16, display: "inline-block" }}>
          Descargar plantilla
        </a>
        <form onSubmit={handleImport} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label htmlFor="import-board">Tablero</label>
            <select id="import-board" value={boardId} onChange={(e) => setBoardId(e.target.value)} required>
              <option value="">Selecciona un tablero…</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="import-file">Archivo</label>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <button type="submit" className="btn primary" disabled={!boardId || !file || importing} style={{ alignSelf: "flex-start" }}>
            {importing ? "Importando…" : "Importar"}
          </button>
        </form>
        {error && (
          <p role="alert" className="field-error" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        {result && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13.5 }}>
              {result.created > 0
                ? `${result.created} tarea(s) creada(s) correctamente.`
                : result.errors.length === 0
                  ? "El archivo no tenía filas de datos."
                  : null}
            </p>
            {result.errors.length > 0 && (
              <ul style={{ fontSize: 12.5, color: "var(--high)", paddingLeft: 18 }}>
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Fila {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Paso 3: Implementar la página**

  ```tsx
  // src/app/admin/importar-tareas/page.tsx
  "use client";
  import ImportTasksPanel from "@/components/ImportTasksPanel";

  export default function AdminImportarTareasPage() {
    return <ImportTasksPanel />;
  }
  ```

- [ ] **Paso 4: Agregar el link al sidebar**

  Usar el archivo encontrado en el Paso 1 — agregar una entrada
  `{ href: "/admin/importar-tareas", label: "Importar tareas", icon: "📥" }`
  (o la forma exacta que sigan las entradas vecinas de esa sección
  "PRODUCTO") justo después de "Tareas recurrentes", siguiendo el mismo
  patrón/formato ya usado por las entradas existentes en ese archivo.

- [ ] **Paso 5: Verificar tipos y build**

  ```bash
  npx tsc --noEmit
  npm run build
  ```

- [ ] **Paso 6: Verificar en el navegador**

  1. `preview_start` con el server de dev, iniciar sesión como owner.
  2. Ir a `/admin/importar-tareas` desde el link del sidebar.
  3. Descargar la plantilla, llenarla con 2 filas válidas + 1 fila con
     "Estado" inválido a propósito, guardarla.
  4. Elegir el tablero, subir el archivo, click "Importar".
  5. Confirmar: mensaje "2 tarea(s) creada(s)", 1 error listado con el
     número de fila correcto, y que las 2 tareas nuevas aparecen en el
     tablero real en la columna correcta.
  6. Eliminar las 2 tareas de prueba creadas (limpieza).

- [ ] **Paso 7: Commit**

  ```bash
  git add src/components/ImportTasksPanel.tsx src/app/admin/importar-tareas/page.tsx <archivo-del-sidebar>
  git commit -m "$(cat <<'EOF'
  feat: panel de importación masiva de tareas en Administración

  Nueva página /admin/importar-tareas: selector de tablero, descarga de
  plantilla, subida de archivo, y resumen de tareas creadas + errores
  por fila. Consume los endpoints de la Tarea 2 y 3.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 5: Despliegue a producción

- [ ] **Paso 1:** `git push origin main`
- [ ] **Paso 2:** `vercel deploy --prod`
- [ ] **Paso 3:** `curl -s https://task.conto.ec/api/health`
- [ ] **Paso 4:** Repetir la verificación manual del Paso 6 de la Tarea 4,
  esta vez contra `https://task.conto.ec`, con limpieza de las tareas
  de prueba al terminar.

---

## Autorrevisión

- **Cobertura del spec:** plantilla descargable (Tarea 2), subida +
  validación + importación parcial (Tareas 1 y 3), límite de 500 filas
  (Tarea 3), página nueva en Administración (Tarea 4) — todo lo
  descrito en el spec está cubierto.
- **Sin placeholders:** cada tarea de código tiene archivos exactos y
  código completo, no descripciones vagas.
- **Consistencia de tipos:** `ParsedTaskRow`/`RowError`/`RawImportRow`
  se definen en la Tarea 1 y se consumen sin cambios en la Tarea 3;
  la forma de la respuesta (`{ created, errors }`) se define en la
  Tarea 3 y se consume igual en la Tarea 4.
