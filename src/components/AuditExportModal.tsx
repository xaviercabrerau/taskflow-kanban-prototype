"use client";

import { useMemo, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { AuditLogRow } from "@/lib/supabase/org-settings-repo";

interface AuditExportModalProps {
  onClose: () => void;
  embedded?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es");
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

export default function AuditExportModal({ onClose, embedded = false }: AuditExportModalProps) {
  const { auditLog, exportAuditLog, orgSettings, updateOrgSettings, isOwner, members } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [retentionDays, setRetentionDays] = useState<number>(orgSettings?.auditRetentionDays ?? 90);
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionFeedback, setRetentionFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const membersById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.fullName || member.email || member.userId);
    }
    return map;
  }, [members]);

  function actorLabel(actorId: string | null): string {
    if (!actorId) return "Sistema";
    return membersById.get(actorId) ?? "Sistema";
  }

  function resourceLabel(row: AuditLogRow): string {
    if (!row.resourceId) return row.resourceType;
    return `${row.resourceType} (${row.resourceId.slice(0, 8)})`;
  }

  function buildCsv(rows: AuditLogRow[]): string {
    const header = "fecha,actor,fuente,accion,recurso";
    const lines = rows.map((row) =>
      [
        csvEscape(formatDate(row.createdAt)),
        csvEscape(actorLabel(row.actorId)),
        csvEscape(row.source),
        csvEscape(row.action),
        csvEscape(resourceLabel(row)),
      ].join(",")
    );
    return [header, ...lines].join("\n");
  }

  function triggerDownload(csv: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-log-export-${todayStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    setExporting(true);
    setExportFeedback(null);
    try {
      const from = fromDate ? new Date(fromDate).toISOString() : undefined;
      const to = toDate ? new Date(toDate).toISOString() : undefined;
      const rows = await exportAuditLog(from, to);
      const csv = buildCsv(rows);
      triggerDownload(csv);
      setExportFeedback({ ok: true, message: `Exportadas ${rows.length} entradas.` });
    } catch (err) {
      setExportFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo exportar el registro." });
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveRetention() {
    setSavingRetention(true);
    setRetentionFeedback(null);
    const result = await updateOrgSettings({ auditRetentionDays: retentionDays });
    setSavingRetention(false);
    setRetentionFeedback(result);
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 620 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="audit-export-modal-title"
      >
        <div className="modal-head">
          <h2 id="audit-export-modal-title">Registro de auditoría</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
            Consulta las últimas 500 entradas del registro de auditoría o exporta un rango de fechas en CSV.
          </p>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              maxHeight: 280,
              overflowY: "auto",
              marginBottom: 16,
            }}
          >
            {auditLog.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13.5, padding: 12, margin: 0 }}>
                Todavía no hay entradas registradas.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 10px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Fecha</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Actor</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Fuente</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Acción</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Recurso</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>{actorLabel(row.actorId)}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>{row.source}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>{row.action}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>{resourceLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>Exportar rango de fechas</label>
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
              <button type="button" className="btn primary" disabled={exporting} onClick={handleExport}>
                {exporting ? "Exportando…" : "Exportar CSV"}
              </button>
            </div>
          </div>

          {exportFeedback && (
            <p style={{ color: exportFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
              {exportFeedback.message}
            </p>
          )}

          {isOwner && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Retención de auditoría</h3>
              <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>
                Las entradas más antiguas que este número de días se eliminan automáticamente cada noche.
              </p>
              <div className="field" style={{ marginBottom: 8 }}>
                <label htmlFor="audit-retention-days">Días de retención</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    id="audit-retention-days"
                    type="number"
                    min={30}
                    max={3650}
                    value={retentionDays}
                    disabled={!orgSettings}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    style={{ width: 120 }}
                  />
                  <button type="button" className="btn primary" disabled={!orgSettings || savingRetention} onClick={handleSaveRetention}>
                    {savingRetention ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
              {retentionFeedback && (
                <p style={{ color: retentionFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                  {retentionFeedback.message}
                </p>
              )}
            </div>
          )}

          <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
            <span />
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
