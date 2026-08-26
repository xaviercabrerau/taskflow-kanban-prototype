"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Cubre las cuentas creadas con contraseña TEMPORAL desde el panel de
// administración (CreateUserPanel / reset-password), marcadas con
// user_metadata.must_change_password = true. Va ANTES que MfaAalGate y
// BoardProvider en layout.tsx a propósito: si alguien todavía arrastra una
// contraseña temporal, no debe llegar ni al paso de MFA ni a los datos del
// board hasta resolverla. No depende de BoardContext (por eso no reutiliza
// el patrón de MfaGate, que sí puede depender de orgSettings).
export default function PasswordChangeGate({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [needsChange, setNeedsChange] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkFlag() {
      const { data, error: userError } = await supabase.auth.getUser();
      if (cancelled) return;

      if (userError || !data.user) {
        setChecking(false);
        setNeedsChange(false);
        return;
      }

      setChecking(false);
      setNeedsChange(Boolean(data.user.user_metadata?.must_change_password));
    }

    checkFlag();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNeedsChange(false);
  }

  if (checking) {
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Verificando…</p>
      </div>
    );
  }

  if (needsChange) {
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <div className="modal" style={{ width: 420 }}>
          <div className="modal-head">
            <h2>Elige una nueva contraseña</h2>
          </div>
          <div className="modal-body">
            <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 16 }}>
              Tu cuenta tiene una contraseña temporal. Debes elegir una definitiva antes de continuar.
            </p>
            <form onSubmit={handleSubmit}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="pw-gate-password">Nueva contraseña</label>
                <input
                  id="pw-gate-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div className="field" style={{ marginBottom: 4 }}>
                <label htmlFor="pw-gate-confirm">Confirmar contraseña</label>
                <input
                  id="pw-gate-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="repite la contraseña"
                  minLength={8}
                  required
                />
              </div>
              {error && (
                <p style={{ color: "var(--high)", fontSize: 13.5, marginTop: 8 }}>{error}</p>
              )}
              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar contraseña"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
