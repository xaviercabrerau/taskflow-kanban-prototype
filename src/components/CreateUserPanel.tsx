"use client";

import { useState } from "react";
import { useBoard } from "@/context/BoardContext";

// Complementa InviteModal: "Invitar por email" solo funciona si la persona
// ya tiene cuenta propia en TaskFlow. Este panel crea la cuenta desde cero
// (vía /api/admin/create-user, que necesita SUPABASE_SERVICE_ROLE_KEY en el
// servidor) y de una vez la suma a la organización con el rol elegido.
export default function CreateUserPanel() {
  const { isOwner, roles } = useBoard();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgRole, setOrgRole] = useState("member");
  const [roleId, setRoleId] = useState("");
  const [requirePasswordChange, setRequirePasswordChange] = useState(true);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  // Se activa cuando create-user falla porque el email ya tiene cuenta en
  // Supabase Auth (típicamente un signup abandonado que nunca se sumó a
  // ninguna organización) — ofrece vincular esa cuenta en vez de bloquear.
  const [offerLink, setOfferLink] = useState(false);
  const [linking, setLinking] = useState(false);

  if (!isOwner) return null;

  function resetForm() {
    setEmail("");
    setPassword("");
    setFullName("");
    setOrgRole("member");
    setRoleId("");
    setRequirePasswordChange(true);
    setOfferLink(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);
    setOfferLink(false);
    try {
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim() || undefined,
          orgRole,
          roleId: roleId || undefined,
          requirePasswordChange,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error ?? "No se pudo crear el usuario.";
        setFeedback({ ok: false, message });
        setOfferLink(/already.*registered/i.test(message));
        return;
      }
      setFeedback({ ok: true, message: `Usuario "${email}" creado y añadido a la organización.` });
      resetForm();
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo crear el usuario." });
    } finally {
      setLoading(false);
    }
  }

  async function handleLinkExisting() {
    setLinking(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/link-existing-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password: password || undefined,
          fullName: fullName.trim() || undefined,
          orgRole,
          roleId: roleId || undefined,
          requirePasswordChange,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, message: data.error ?? "No se pudo vincular la cuenta." });
        return;
      }
      setFeedback({ ok: true, message: `Cuenta "${email}" vinculada a la organización.` });
      resetForm();
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo vincular la cuenta." });
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="admin-panel" style={{ marginTop: 20 }}>
      <div className="modal-head" style={{ padding: "0 0 12px" }}>
        <h2 style={{ fontSize: 15 }}>Crear usuario</h2>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-user-email">Email</label>
            <input
              id="new-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@empresa.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-user-password">Contraseña</label>
            <input
              id="new-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
              minLength={8}
              required
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-user-name">Nombre completo</label>
            <input
              id="new-user-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="field">
            <label htmlFor="new-user-org-role">Rol de organización</label>
            <select id="new-user-org-role" value={orgRole} onChange={(e) => setOrgRole(e.target.value)}>
              <option value="member">Miembro</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-user-role">Rol de permisos</label>
            <select id="new-user-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Sin rol</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
          <input
            type="checkbox"
            checked={requirePasswordChange}
            onChange={(e) => setRequirePasswordChange(e.target.checked)}
          />
          Temporal — exigir cambio de contraseña al iniciar sesión
        </label>
        {feedback && (
          <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 4 }}>
            {feedback.message}
          </p>
        )}
        {offerLink && (
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Ya existe una cuenta con ese email (probablemente un registro abandonado). Puedes vincularla a esta
            organización usando el nombre, rol y contraseña ya escritos arriba.
          </p>
        )}
        <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
          {offerLink ? (
            <button type="button" className="btn" onClick={handleLinkExisting} disabled={linking}>
              {linking ? "Vinculando…" : "Vincular cuenta existente"}
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "Creando…" : "Crear usuario"}
          </button>
        </div>
      </form>
    </div>
  );
}
