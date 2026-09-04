"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { MarketplaceTemplate } from "@/lib/supabase/templates-repo";

interface TemplateMarketplaceModalProps {
  onClose: () => void;
  embedded?: boolean;
}

const DEFAULT_INSTALL_ICON = "📋";

export default function TemplateMarketplaceModal({ onClose, embedded = false }: TemplateMarketplaceModalProps) {
  const { createWorkspace, isOwner } = useBoard();
  const { marketplaceTemplates, ownTemplates, publishTemplate, setTemplatePublic } = useAdminData();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installName, setInstallName] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<Record<string, { ok: boolean; message: string }>>({});

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleFeedback, setToggleFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [publishName, setPublishName] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function startInstall(templateId: string) {
    setInstallingId(templateId);
    setInstallName("");
  }

  function cancelInstall() {
    setInstallingId(null);
    setInstallName("");
  }

  async function handleInstall(e: React.FormEvent, template: MarketplaceTemplate) {
    e.preventDefault();
    if (!installName.trim()) return;
    setInstalling(true);
    const result = await createWorkspace(installName.trim(), DEFAULT_INSTALL_ICON, template);
    setInstalling(false);
    setInstallFeedback((prev) => ({ ...prev, [template.id]: result }));
    if (result.ok) {
      setInstallingId(null);
      setInstallName("");
    }
  }

  async function handleTogglePublic(templateId: string, isPublic: boolean) {
    setTogglingId(templateId);
    const result = await setTemplatePublic(templateId, !isPublic);
    setTogglingId(null);
    setToggleFeedback(result);
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!publishName.trim()) return;
    setPublishing(true);
    const result = await publishTemplate(publishName.trim(), publishDescription.trim());
    setPublishing(false);
    setPublishFeedback(result);
    if (result.ok) {
      setPublishName("");
      setPublishDescription("");
    }
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 560 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="template-marketplace-modal-title"
      >
        <div className="modal-head">
          <h2 id="template-marketplace-modal-title">Marketplace de plantillas</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Marketplace</h3>
          {marketplaceTemplates.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 16 }}>
              Todavía no hay plantillas publicadas en el marketplace.
            </p>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {marketplaceTemplates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{template.name}</div>
                      {template.description && (
                        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                          {template.description}
                        </div>
                      )}
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                        Instalado {template.installCount} veces
                      </div>
                    </div>
                    {installingId !== template.id && (
                      <button type="button" className="btn" onClick={() => startInstall(template.id)}>
                        Instalar
                      </button>
                    )}
                  </div>

                  {installingId === template.id && (
                    <form
                      onSubmit={(e) => handleInstall(e, template)}
                      style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}
                    >
                      <div className="field">
                        <label htmlFor={`install-name-${template.id}`}>Nombre del área de trabajo</label>
                        <input
                          id={`install-name-${template.id}`}
                          type="text"
                          value={installName}
                          onChange={(e) => setInstallName(e.target.value)}
                          placeholder="Ej. Soporte al cliente"
                          required
                          autoFocus
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                        <button type="button" className="btn" onClick={cancelInstall}>
                          Cancelar
                        </button>
                        <button type="submit" className="btn primary" disabled={installing}>
                          {installing ? "Instalando…" : "Instalar"}
                        </button>
                      </div>
                    </form>
                  )}

                  {installFeedback[template.id] && (
                    <p
                      style={{
                        color: installFeedback[template.id].ok ? "var(--accent)" : "var(--high)",
                        fontSize: 13.5,
                        marginTop: 8,
                        marginBottom: 0,
                      }}
                    >
                      {installFeedback[template.id].message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Tus plantillas</h3>

              {ownTemplates.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 16 }}>
                  Todavía no has publicado ninguna plantilla propia.
                </p>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  {ownTemplates.map((template) => (
                    <div
                      key={template.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        marginBottom: 8,
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{template.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}>
                          <span>Instalado {template.installCount} veces</span>
                          <span>·</span>
                          <span style={{ color: template.isPublic ? "var(--accent)" : "var(--muted)" }}>
                            {template.isPublic ? "Publicada" : "No publicada"}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        disabled={togglingId === template.id}
                        onClick={() => handleTogglePublic(template.id, template.isPublic)}
                      >
                        {togglingId === template.id
                          ? "Guardando…"
                          : template.isPublic
                          ? "Despublicar"
                          : "Publicar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {toggleFeedback && (
                <p style={{ color: toggleFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 0, marginBottom: 16 }}>
                  {toggleFeedback.message}
                </p>
              )}

              <form onSubmit={handlePublish} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <label style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8, display: "block" }}>
                  Publicar tablero actual como plantilla
                </label>
                <div className="field">
                  <label htmlFor="publish-template-name">Nombre</label>
                  <input
                    id="publish-template-name"
                    type="text"
                    value={publishName}
                    onChange={(e) => setPublishName(e.target.value)}
                    placeholder="Ej. Sprint de desarrollo"
                    required
                  />
                </div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor="publish-template-description">Descripción</label>
                  <textarea
                    id="publish-template-description"
                    value={publishDescription}
                    onChange={(e) => setPublishDescription(e.target.value)}
                    placeholder="Describe para qué sirve esta plantilla"
                    rows={3}
                  />
                </div>

                {publishFeedback && (
                  <p style={{ color: publishFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                    {publishFeedback.message}
                  </p>
                )}

                <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                  <span />
                  <button type="submit" className="btn primary" disabled={publishing}>
                    {publishing ? "Publicando…" : "Publicar"}
                  </button>
                </div>
              </form>
            </div>
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
