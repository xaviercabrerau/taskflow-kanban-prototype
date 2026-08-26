"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { fetchBoardTemplates, type BoardTemplate } from "@/lib/supabase/templates-repo";

interface WorkspaceModalProps {
  onClose: () => void;
  embedded?: boolean;
}

const ICON_OPTIONS = ["📋", "💻", "📣", "💰", "🎯"];

export default function WorkspaceModal({ onClose, embedded = false }: WorkspaceModalProps) {
  const { supabase, tenantId, isOwner, workspaces, activeWorkspaceId, switchWorkspace, createWorkspace } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [templates, setTemplates] = useState<BoardTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(ICON_OPTIONS[0]);
  const [templateId, setTemplateId] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!isOwner || !tenantId) return;
    fetchBoardTemplates(supabase, tenantId)
      .then((fetched) => {
        setTemplates(fetched);
        setTemplateId(fetched[0]?.id ?? "");
      })
      .catch((err) => {
        console.error("No se pudieron cargar las plantillas:", err);
        setTemplatesError("No se pudieron cargar las plantillas.");
      });
  }, [isOwner, tenantId, supabase]);

  function handleSwitch(target: { boardId: string; workspaceId: string }) {
    switchWorkspace(target);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const template = templates.find((t) => t.id === templateId);
    if (!name.trim() || !template) return;
    setSaving(true);
    const result = await createWorkspace(name.trim(), icon, template);
    setSaving(false);
    setFeedback(result);
    if (result.ok) {
      setName("");
      onClose();
    }
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 440 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="workspace-modal-title"
      >
        <div className="modal-head">
          <h2 id="workspace-modal-title">Áreas de trabajo</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 16 }}>
            {workspaces.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Todavía no hay áreas de trabajo.</p>
            )}
            {workspaces.map((ws) => {
              const isActive = ws.workspaceId === activeWorkspaceId;
              return (
                <div
                  key={ws.workspaceId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 13.5 }}>
                    {ws.icon ?? "📋"} <b>{ws.name}</b>
                    {isActive && (
                      <span style={{ color: "var(--accent)", fontSize: 12, marginLeft: 8 }}>· Actual</span>
                    )}
                  </span>
                  {!isActive && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleSwitch({ boardId: ws.boardId, workspaceId: ws.workspaceId })}
                    >
                      Cambiar
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {isOwner && (
            <form onSubmit={handleSubmit} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <label style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8, display: "block" }}>
                Nueva área de trabajo
              </label>
              <div className="field">
                <label htmlFor="workspace-name">Nombre</label>
                <input
                  id="workspace-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Soporte al cliente"
                  required
                />
              </div>

              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="workspace-icon">Icono</label>
                <select id="workspace-icon" value={icon} onChange={(e) => setIcon(e.target.value)}>
                  {ICON_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="workspace-template">Plantilla</label>
                <select
                  id="workspace-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  required
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {templatesError && (
                  <p style={{ color: "var(--high)", fontSize: 12.5, marginTop: 4 }}>{templatesError}</p>
                )}
              </div>

              {feedback && (
                <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 12 }}>
                  {feedback.message}
                </p>
              )}

              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={saving || templates.length === 0}>
                  {saving ? "Creando…" : "Crear área de trabajo"}
                </button>
              </div>
            </form>
          )}
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
