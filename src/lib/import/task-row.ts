export const IMPORT_HEADERS = [
  "Título",
  "Estado",
  "Prioridad",
  "Asignado",
  "Etiqueta",
  "Fecha inicio",
  "Fecha vencimiento",
] as const;

const [TITULO, ESTADO, PRIORIDAD, ASIGNADO, ETIQUETA, FECHA_INICIO, FECHA_VENCIMIENTO] =
  IMPORT_HEADERS;

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

  const title = readText(raw, TITULO);
  if (!title) errors.push("Título es obligatorio");

  const estadoRaw = raw[ESTADO];
  const estadoKey = readText(raw, ESTADO).toLowerCase();
  const columnId = columnLabelToId.get(estadoKey);
  if (!estadoKey) {
    errors.push("Estado es obligatorio");
  } else if (!columnId) {
    errors.push(`Estado "${estadoRaw}" no coincide con ninguna columna del tablero`);
  }

  let priority: ParsedPriority = "medium";
  const priorityText = readText(raw, PRIORIDAD);
  if (priorityText) {
    const mapped = PRIORITY_MAP[priorityText.toLowerCase()];
    if (!mapped) {
      errors.push(`Prioridad "${priorityText}" no reconocida (usa Baja/Media/Alta/Urgente)`);
    } else {
      priority = mapped;
    }
  }

  const assignee = readText(raw, ASIGNADO) || undefined;
  const tag = readText(raw, ETIQUETA) || undefined;
  const startDate = normalizeDateField(raw, FECHA_INICIO, errors);
  const dueDate = normalizeDateField(raw, FECHA_VENCIMIENTO, errors);

  if (errors.length > 0) {
    return { error: { row: rowNumber, reason: errors.join("; ") } };
  }

  return {
    row: { title, columnId: columnId!, priority, assignee, tag, startDate, dueDate },
  };
}
