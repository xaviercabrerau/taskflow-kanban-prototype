"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface SsoSettingsModalProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function SsoSettingsModal({ onClose, embedded = false }: SsoSettingsModalProps) {
  const { isOwner } = useBoard();
  const { orgSettings, updateOrgSettings } = useAdminData();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [ssoEnabled, setSsoEnabled] = useState(orgSettings?.ssoEnabled ?? false);
  const [ssoDomain, setSsoDomain] = useState(orgSettings?.ssoDomain ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateOrgSettings({
      ssoEnabled,
      ssoDomain: ssoDomain.trim() || null,
    });
    setSaving(false);
    setFeedback(result);
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 460 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="sso-settings-modal-title"
      >
        <div className="modal-head">
          <h2 id="sso-settings-modal-title">Inicio de sesión SSO</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          {!isOwner ? (
            <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Solo el propietario puede configurar SSO.</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={ssoEnabled}
                  onChange={(e) => setSsoEnabled(e.target.checked)}
                />
                Habilitar inicio de sesión SSO
              </label>

              <div className="field">
                <label htmlFor="sso-domain">Dominio de correo</label>
                <input
                  id="sso-domain"
                  type="text"
                  value={ssoDomain}
                  onChange={(e) => setSsoDomain(e.target.value)}
                  placeholder="acme.com"
                />
              </div>

              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
                Esto solo guarda el dominio y activa el botón de SSO en el login; registrar el proveedor de identidad
                (Entra ID, Okta, etc.) en Supabase Auth requiere la Management API o una service-role key y debe
                configurarlo un administrador fuera de esta app (Supabase Dashboard o CLI).
              </p>

              {feedback && (
                <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                  {feedback.message}
                </p>
              )}

              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
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
