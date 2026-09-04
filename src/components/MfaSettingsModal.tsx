"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { createClient } from "@/lib/supabase/client";

interface MfaSettingsModalProps {
  onClose: () => void;
  embedded?: boolean;
}

interface TotpFactor {
  id: string;
  status: "verified" | "unverified";
  friendly_name?: string;
}

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function MfaSettingsModal({ onClose, embedded = false }: MfaSettingsModalProps) {
  const { isOwner } = useBoard();
  const { orgSettings, updateOrgSettings } = useAdminData();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);
  const supabase = createClient();

  const [mfaRequired, setMfaRequired] = useState(orgSettings?.mfaRequired ?? false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgFeedback, setOrgFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [loadingFactors, setLoadingFactors] = useState(true);
  const [factorFeedback, setFactorFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [enrolling, setEnrolling] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function refreshFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    setLoadingFactors(false);
    if (error) {
      setFactorFeedback({ ok: false, message: error.message });
      return;
    }
    setFactors((data?.totp ?? []).filter((f) => f.status === "verified"));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleMfaRequired(e: React.FormEvent) {
    e.preventDefault();
    setSavingOrg(true);
    const result = await updateOrgSettings({ mfaRequired });
    setSavingOrg(false);
    setOrgFeedback(result);
  }

  async function handleRemoveFactor(factorId: string, friendlyName?: string) {
    const confirmed = window.confirm(
      `¿Quitar el método de verificación en dos pasos "${friendlyName ?? factorId}"?`
    );
    if (!confirmed) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setFactorFeedback({ ok: false, message: error.message });
      return;
    }
    setFactorFeedback({ ok: true, message: "Método eliminado." });
    await refreshFactors();
  }

  async function handleStartEnroll() {
    setEnrolling(true);
    setVerifyFeedback(null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setEnrolling(false);
    if (error) {
      setVerifyFeedback({ ok: false, message: error.message });
      return;
    }
    if (data) {
      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    }
  }

  function cancelEnrollment() {
    setEnrollment(null);
    setCode("");
    setVerifyFeedback(null);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollment || !code.trim()) return;
    setVerifying(true);
    setVerifyFeedback(null);

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    });
    if (challengeError || !challengeData) {
      setVerifying(false);
      setVerifyFeedback({ ok: false, message: challengeError?.message ?? "No se pudo iniciar el desafío." });
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challengeData.id,
      code: code.trim(),
    });
    setVerifying(false);
    if (verifyError) {
      setVerifyFeedback({ ok: false, message: verifyError.message });
      return;
    }

    setEnrollment(null);
    setCode("");
    setVerifyFeedback({ ok: true, message: "Verificación en dos pasos activada." });
    await refreshFactors();
  }

  const panel = (
    <div
      className={embedded ? "admin-panel" : "modal"}
      style={embedded ? undefined : { width: 520 }}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
      ref={modalRef}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby="mfa-settings-modal-title"
    >
        <div className="modal-head">
          <h2 id="mfa-settings-modal-title">Verificación en dos pasos</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          {isOwner && (
            <form onSubmit={handleToggleMfaRequired} style={{ marginBottom: 20 }}>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                  <input
                    type="checkbox"
                    checked={mfaRequired}
                    onChange={(e) => setMfaRequired(e.target.checked)}
                  />
                  Requerir MFA para todos los miembros de la organización
                </label>
                <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 4 }}>
                  Los miembros sin verificación en dos pasos activa no podrán acceder al workspace.
                </p>
              </div>

              {orgFeedback && (
                <p style={{ color: orgFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                  {orgFeedback.message}
                </p>
              )}

              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={savingOrg}>
                  {savingOrg ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          )}

          <div style={{ borderTop: isOwner ? "1px solid var(--border)" : "none", paddingTop: isOwner ? 16 : 0 }}>
            <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>Tu verificación en dos pasos</h3>

            {loadingFactors ? (
              <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Cargando métodos…</p>
            ) : (
              <div className="field" style={{ marginBottom: 12 }}>
                {factors.length === 0 && (
                  <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
                    Todavía no tienes un método de verificación en dos pasos activo.
                  </p>
                )}
                {factors.map((factor) => (
                  <div
                    key={factor.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                      {factor.friendly_name ?? "Autenticador TOTP"}
                    </span>
                    <button type="button" className="btn" onClick={() => handleRemoveFactor(factor.id, factor.friendly_name)}>
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {factorFeedback && (
              <p style={{ color: factorFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginBottom: 12 }}>
                {factorFeedback.message}
              </p>
            )}

            {!enrollment ? (
              <button type="button" className="btn" disabled={enrolling} onClick={handleStartEnroll}>
                {enrolling ? "Preparando…" : "Agregar autenticación TOTP"}
              </button>
            ) : (
              <form onSubmit={handleVerify} style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                  Escanea este código QR con tu app de autenticación (Google Authenticator, 1Password, etc.) o
                  ingresa la clave manualmente.
                </p>
                {/* enrollment.qrCode viene directo de supabase.auth.mfa.enroll() —
                    generado por Supabase, nunca por input del usuario. */}
                <div
                  style={{ maxWidth: 200, marginBottom: 8 }}
                  dangerouslySetInnerHTML={{ __html: enrollment.qrCode }}
                />
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Clave manual</label>
                  <code
                    style={{
                      display: "block",
                      fontSize: 12,
                      background: "var(--surface-2, #1a1a1a10)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      overflowX: "auto",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {enrollment.secret}
                  </code>
                </div>
                <div className="field">
                  <label htmlFor="mfa-verify-code">Código de 6 dígitos</label>
                  <input
                    id="mfa-verify-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    required
                    autoFocus
                  />
                </div>

                {verifyFeedback && (
                  <p style={{ color: verifyFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                    {verifyFeedback.message}
                  </p>
                )}

                <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                  <button type="button" className="btn" onClick={cancelEnrollment}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn primary" disabled={verifying}>
                    {verifying ? "Verificando…" : "Verificar"}
                  </button>
                </div>
              </form>
            )}
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
