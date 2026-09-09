"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import AdminPanelShell from "./AdminPanelShell";

interface BoardOption {
  id: string;
  name: string;
}

interface ImportResult {
  created: number;
  errors: { row: number; reason: string }[];
}

interface ImportTasksPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function ImportTasksPanel({ onClose, embedded = false }: ImportTasksPanelProps) {
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
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message);
          return;
        }
        setBoards(data ?? []);
      });
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
    <AdminPanelShell embedded={embedded} onClose={onClose} title="Importar tareas">
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
        <div style={{ marginTop: 16 }} aria-live="polite">
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
    </AdminPanelShell>
  );
}
