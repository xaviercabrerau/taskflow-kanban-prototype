"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { fetchPortfolioSummary, type PortfolioBoardSummary } from "@/lib/supabase/portfolio-repo";
import { downloadCsv } from "@/lib/csvExport";

interface PortfolioPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function PortfolioPanel({ embedded = false }: PortfolioPanelProps) {
  const { supabase } = useBoard();
  const [boards, setBoards] = useState<PortfolioBoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPortfolioSummary(supabase)
      .then((data) => {
        if (!cancelled) setBoards(data);
      })
      .catch((err) => {
        console.error("No se pudo cargar el portafolio:", err);
        if (!cancelled) setError("No se pudo cargar el portafolio de tableros.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function handleExportCsv() {
    downloadCsv(
      "portafolio-tableros.csv",
      ["Tablero", "Total tareas", "Terminadas", "Vencidas"],
      boards.map((b) => [b.boardName, b.totalTasks, b.doneTasks, b.overdueTasks])
    );
  }

  const panel = (
    <div className={embedded ? "admin-panel" : "modal"} style={embedded ? undefined : { width: 560 }}>
      <div className="modal-head">
        <h2>Portafolio de tableros</h2>
      </div>
      <div className="modal-body">
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button type="button" className="btn" onClick={handleExportCsv} disabled={boards.length === 0}>
            ⬇️ Exportar CSV
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            🖨️ Imprimir / PDF
          </button>
        </div>
        {loading ? (
          <p>Cargando…</p>
        ) : boards.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Sin tableros visibles todavía.</p>
        ) : (
          boards.map((b) => {
            const pct = b.totalTasks ? Math.round((b.doneTasks / b.totalTasks) * 100) : 0;
            return (
              <div
                key={b.boardId}
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{b.boardName}</span>
                  {b.overdueTasks > 0 && (
                    <span className="due-badge overdue">{b.overdueTasks} vencida(s)</span>
                  )}
                </div>
                <div className="checklist-progress-row" style={{ marginTop: 6 }}>
                  <span className="checklist-pct">{pct}%</span>
                  <div className="checklist-progress-track">
                    <div className="checklist-progress-fill" style={{ transform: `scaleX(${b.totalTasks ? b.doneTasks / b.totalTasks : 0})` }} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {b.doneTasks}/{b.totalTasks} tareas terminadas
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  if (embedded) return panel;
  return <div className="modal-backdrop">{panel}</div>;
}
