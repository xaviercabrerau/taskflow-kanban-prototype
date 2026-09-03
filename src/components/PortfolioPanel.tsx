"use client";

import { useBoard } from "@/context/BoardContext";
import { fetchPortfolioSummary, type PortfolioBoardSummary } from "@/lib/supabase/portfolio-repo";
import { downloadCsv } from "@/lib/csvExport";
import AdminPanelShell from "./AdminPanelShell";
import { useEmbeddedPanelData } from "@/hooks/useEmbeddedPanelData";

interface PortfolioPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function PortfolioPanel({ onClose, embedded = false }: PortfolioPanelProps) {
  const { supabase } = useBoard();
  const { data, loading, error } = useEmbeddedPanelData<PortfolioBoardSummary[]>(
    () => fetchPortfolioSummary(supabase),
    [supabase],
    { errorMessage: "No se pudo cargar el portafolio de tableros." }
  );
  const boards = data ?? [];

  function handleExportCsv() {
    downloadCsv(
      "portafolio-tableros.csv",
      ["Tablero", "Total tareas", "Terminadas", "Vencidas"],
      boards.map((b) => [b.boardName, b.totalTasks, b.doneTasks, b.overdueTasks])
    );
  }

  return (
    <AdminPanelShell
      embedded={embedded}
      onClose={onClose}
      title="Portafolio de tableros"
      actions={
        <>
          <button type="button" className="btn" onClick={handleExportCsv} disabled={boards.length === 0}>
            ⬇️ Exportar CSV
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            🖨️ Imprimir / PDF
          </button>
        </>
      }
    >
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
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
    </AdminPanelShell>
  );
}
