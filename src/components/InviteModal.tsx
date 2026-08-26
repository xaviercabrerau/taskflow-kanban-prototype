"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface InviteModalProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function InviteModal({ onClose, embedded = false }: InviteModalProps) {
  const { members, inviteMember, isOwner, roles, memberRoleIds, assignMemberRole, userId } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Restablecer contraseña de un miembro ya existente (owner-only). Solo un
  // panel de reseteo abierto a la vez, identificado por el userId objetivo.
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetRequireChange, setResetRequireChange] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    const result = await inviteMember(email.trim());
    setLoading(false);
    setFeedback(result);
    if (result.ok) setEmail("");
  }

  function openResetFor(targetUserId: string) {
    setResetTargetId((current) => (current === targetUserId ? null : targetUserId));
    setResetPassword("");
    setResetRequireChange(true);
    setResetFeedback(null);
  }

  async function handleResetSubmit(e: React.FormEvent, targetUserId: string) {
    e.preventDefault();
    setResetLoading(true);
    setResetFeedback(null);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUserId,
          password: resetPassword,
          requirePasswordChange: resetRequireChange,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetFeedback({ ok: false, message: data.error ?? "No se pudo restablecer la contraseña." });
        return;
      }
      setResetFeedback({ ok: true, message: "Contraseña restablecida." });
      setResetPassword("");
    } catch (err) {
      setResetFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo restablecer la contraseña." });
    } finally {
      setResetLoading(false);
    }
  }

  const panel = (
    <div
      className={embedded ? "admin-panel" : "modal"}
      style={embedded ? undefined : { width: 420 }}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
      ref={modalRef}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby="invite-modal-title"
    >
      <div className="modal-head">
        <h2 id="invite-modal-title">Miembros de la organización</h2>
        {!embedded && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        )}
      </div>
      <div className="modal-body">
        <div className="field" style={{ marginBottom: 16 }}>
            {members.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Solo tú, por ahora.</p>}
            {members.map((m) => (
              <div key={m.membershipId} style={{ padding: "6px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5, gap: 8 }}>
                  <span>{m.fullName || m.email || m.userId}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isOwner && m.userId !== userId && m.orgRole !== "owner" ? (
                      <select
                        value={memberRoleIds[m.userId] ?? ""}
                        onChange={(e) => e.target.value && assignMemberRole(m.userId, e.target.value)}
                        style={{ fontSize: 12.5 }}
                      >
                        <option value="" disabled>
                          Sin rol
                        </option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>{m.orgRole}</span>
                    )}
                    {isOwner && m.userId !== userId && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Restablecer contraseña"
                        aria-label="Restablecer contraseña"
                        onClick={() => openResetFor(m.userId)}
                      >
                        🔑
                      </button>
                    )}
                  </div>
                </div>
                {resetTargetId === m.userId && (
                  <form
                    onSubmit={(e) => handleResetSubmit(e, m.userId)}
                    style={{ marginTop: 8, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }}
                  >
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label htmlFor={`reset-password-${m.userId}`}>Nueva contraseña</label>
                      <input
                        id={`reset-password-${m.userId}`}
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="mínimo 8 caracteres"
                        minLength={8}
                        required
                      />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
                      <input
                        type="checkbox"
                        checked={resetRequireChange}
                        onChange={(e) => setResetRequireChange(e.target.checked)}
                      />
                      Temporal — exigir cambio al iniciar sesión
                    </label>
                    {resetFeedback && (
                      <p style={{ color: resetFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 12.5, marginTop: 6 }}>
                        {resetFeedback.message}
                      </p>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <button type="submit" className="btn primary" disabled={resetLoading} style={{ fontSize: 12.5 }}>
                        {resetLoading ? "Guardando…" : resetRequireChange ? "Asignar contraseña temporal" : "Asignar contraseña definitiva"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
          {isOwner && (
            <>
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="invite-email">Invitar por email</label>
                  <input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colega@empresa.com"
                    required
                  />
                </div>
                {feedback && (
                  <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                    {feedback.message}
                  </p>
                )}
                <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                  <span />
                  <button type="submit" className="btn primary" disabled={loading}>
                    {loading ? "Invitando…" : "Invitar"}
                  </button>
                </div>
              </form>
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
                Solo funciona con emails que ya tienen cuenta en TaskFlow (registrada en /login).
              </p>
            </>
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
