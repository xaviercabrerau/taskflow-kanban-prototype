"use client";

import { useBoard } from "@/context/BoardContext";
import { fetchTimeEntriesForTasks, type TimeEntry } from "@/lib/supabase/time-entries-repo";
import { downloadCsv } from "@/lib/csvExport";
import AdminPanelShell from "./AdminPanelShell";
import { useEmbeddedPanelData } from "@/hooks/useEmbeddedPanelData";

interface WorkloadPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function WorkloadPanel({ onClose, embedded = false }: WorkloadPanelProps) {
  const { supabase, state, members } = useBoard();
  const taskIds = Object.keys(state.tasks);

  const { data, loading } = useEmbeddedPanelData<TimeEntry[]>(
    () => fetchTimeEntriesForTasks(supabase, taskIds),
    // taskIds.length (no state.tasks) es la dependencia real: editar el
    // título/prioridad de una tarea existente crea un nuevo objeto
    // state.tasks en cada mutación, pero no cambia qué tareas hay que
    // consultar — usar state.tasks completo relanzaba el fetch (y
    // "Cargando…" parpadeaba) en cada edición del tablero, no solo cuando
    // se agrega/quita una tarea (hallazgo de la ronda de QA).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, taskIds.length],
    { skip: taskIds.length === 0, errorMessage: "No se pudieron cargar las horas registradas." }
  );
  const entries = data ?? [];

  const doneColumnIds = new Set(state.columns.filter((c) => c.isDoneState).map((c) => c.id));
  const minutesByUser = new Map<string, number>();
  for (const e of entries) {
    minutesByUser.set(e.userId, (minutesByUser.get(e.userId) ?? 0) + (e.minutes ?? 0));
  }

  const rows = members.map((m) => {
    const openTasks = Object.values(state.tasks).filter((t) => {
      if (t.assigneeUserId !== m.userId) return false;
      const col = state.columns.find((c) => c.taskIds.includes(t.id));
      return col ? !doneColumnIds.has(col.id) : false;
    }).length;
    const totalMinutes = minutesByUser.get(m.userId) ?? 0;
    return {
      userId: m.userId,
      label: m.fullName || m.email || m.userId,
      openTasks,
      hours: Math.round((totalMinutes / 60) * 10) / 10,
    };
  });

  const maxOpenTasks = Math.max(1, ...rows.map((r) => r.openTasks));

  function handleExportCsv() {
    downloadCsv(
      "carga-de-trabajo.csv",
      ["Persona", "Tareas abiertas", "Horas registradas"],
      rows.map((r) => [r.label, r.openTasks, r.hours])
    );
  }

  return (
    <AdminPanelShell
      embedded={embedded}
      onClose={onClose}
      title="Carga de trabajo"
      actions={
        <>
          <button type="button" className="btn" onClick={handleExportCsv}>
            ⬇️ Exportar CSV
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            🖨️ Imprimir / PDF
          </button>
        </>
      }
    >
      {loading ? (
        <p>Cargando…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Sin miembros en este tablero todavía.</p>
      ) : (
        rows.map((r) => (
          <div key={r.userId} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>{r.label}</span>
              <span style={{ color: "var(--muted)" }}>
                {r.openTasks} tarea(s) abiertas · {r.hours}h registradas
              </span>
            </div>
            <div className="checklist-progress-track" style={{ marginTop: 4 }}>
              <div
                className="checklist-progress-fill"
                style={{ transform: `scaleX(${r.openTasks / maxOpenTasks})`, background: "var(--accent)" }}
              />
            </div>
          </div>
        ))
      )}
    </AdminPanelShell>
  );
}
