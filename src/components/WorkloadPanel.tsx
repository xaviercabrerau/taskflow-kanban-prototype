"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { fetchTimeEntriesForTasks, type TimeEntry } from "@/lib/supabase/time-entries-repo";
import { downloadCsv } from "@/lib/csvExport";

interface WorkloadPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function WorkloadPanel({ embedded = false }: WorkloadPanelProps) {
  const { supabase, state, members } = useBoard();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const taskIds = Object.keys(state.tasks);

  useEffect(() => {
    if (taskIds.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchTimeEntriesForTasks(supabase, taskIds)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => console.error("No se pudieron cargar las horas registradas:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taskIds se recalcula cada render; solo importa su tamaño real (board activo)
  }, [supabase, state.tasks]);

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

  const panel = (
    <div className={embedded ? "admin-panel" : "modal"} style={embedded ? undefined : { width: 560 }}>
      <div className="modal-head">
        <h2>Carga de trabajo</h2>
      </div>
      <div className="modal-body">
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button type="button" className="btn" onClick={handleExportCsv}>
            ⬇️ Exportar CSV
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            🖨️ Imprimir / PDF
          </button>
        </div>
        {loading ? (
          <p>Cargando…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Sin miembros en este tablero todavía.</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} style={{ marginBottom: 12 }}>
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
      </div>
    </div>
  );

  if (embedded) return panel;
  return <div className="modal-backdrop">{panel}</div>;
}
