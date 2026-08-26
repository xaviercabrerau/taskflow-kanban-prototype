"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { MetricsReport } from "@/lib/supabase/metrics-repo";

interface ReportsModalProps {
  onClose: () => void;
  embedded?: boolean;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function ReportsModal({ onClose, embedded = false }: ReportsModalProps) {
  const { fetchReport, generateSnapshot } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [fromDate, setFromDate] = useState(isoDaysAgo(30));
  const [toDate, setToDate] = useState(todayStamp());
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [reportFeedback, setReportFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [generating, setGenerating] = useState(false);
  const [snapshotFeedback, setSnapshotFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleFetchReport() {
    setLoading(true);
    setReportFeedback(null);
    try {
      const result = await fetchReport(fromDate, toDate);
      setReport(result);
      const total = result.throughput.length + result.cycleTime.length;
      setReportFeedback({ ok: true, message: `Reporte generado con ${total} punto(s) de datos.` });
    } catch (err) {
      setReportFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo generar el reporte." });
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateSnapshot() {
    setGenerating(true);
    setSnapshotFeedback(null);
    try {
      const result = await generateSnapshot();
      setSnapshotFeedback(result);
    } catch (err) {
      setSnapshotFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo generar el snapshot." });
    } finally {
      setGenerating(false);
    }
  }

  function buildCsv(data: MetricsReport): string {
    const header = "fecha,tipo,valor";
    const throughputLines = data.throughput.map((point) =>
      [csvEscape(point.date), csvEscape("throughput"), csvEscape(String(point.count))].join(",")
    );
    const cycleTimeLines = data.cycleTime.map((point) =>
      [csvEscape(point.date), csvEscape("cycle_time"), csvEscape(String(point.avgHours))].join(",")
    );
    return [header, ...throughputLines, ...cycleTimeLines].join("\n");
  }

  function triggerDownload(csv: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte-metricas-${todayStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    if (!report) return;
    triggerDownload(buildCsv(report));
  }

  const maxThroughput = Math.max(1, ...(report?.throughput.map((p) => p.count) ?? [0]));
  const maxCycleTime = Math.max(1, ...(report?.cycleTime.map((p) => p.avgHours) ?? [0]));

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 620 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="reports-modal-title"
      >
        <div className="modal-head">
          <h2 id="reports-modal-title">Reportes BI avanzados</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
            Consulta throughput y tiempo de ciclo a partir de los snapshots diarios de métricas del tablero.
          </p>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>Rango de fechas</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                aria-label="Desde"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>a</span>
              <input
                type="date"
                aria-label="Hasta"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
              <button type="button" className="btn primary" disabled={loading} onClick={handleFetchReport}>
                {loading ? "Generando…" : "Generar reporte"}
              </button>
            </div>
          </div>

          {reportFeedback && (
            <p style={{ color: reportFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
              {reportFeedback.message}
            </p>
          )}

          {report && (
            <>
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Throughput</h3>
                {report.throughput.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos de throughput en este rango.</p>
                ) : (
                  <div className="bars-person">
                    {report.throughput.map((point) => (
                      <div className="bp-row" key={point.date}>
                        <div className="bp-name">{point.date}</div>
                        <div className="bp-track">
                          <div
                            className="bp-fill"
                            style={{ width: `${(point.count / maxThroughput) * 100}%` }}
                          />
                        </div>
                        <div className="bp-val mono">{point.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Tiempo de ciclo (promedio)</h3>
                {report.cycleTime.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos de tiempo de ciclo en este rango.</p>
                ) : (
                  <div className="bars-person">
                    {report.cycleTime.map((point) => (
                      <div className="bp-row" key={point.date}>
                        <div className="bp-name">{point.date}</div>
                        <div className="bp-track">
                          <div
                            className="bp-fill"
                            style={{ width: `${(point.avgHours / maxCycleTime) * 100}%` }}
                          />
                        </div>
                        <div className="bp-val mono">
                          {point.avgHours.toFixed(1)}h ({point.taskCount})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Snapshot manual</h3>
            <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>
              Normalmente esto corre automáticamente cada noche. Usa este botón para generar el snapshot de hoy
              manualmente, útil para demos o pruebas en tableros nuevos.
            </p>
            <button type="button" className="btn" disabled={generating} onClick={handleGenerateSnapshot}>
              {generating ? "Generando…" : "Generar snapshot de hoy"}
            </button>
            {snapshotFeedback && (
              <p style={{ color: snapshotFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                {snapshotFeedback.message}
              </p>
            )}
          </div>

          <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
            <button type="button" className="btn primary" disabled={!report} onClick={handleExportCsv}>
              Exportar CSV
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {panel}
    </div>
  );
}
