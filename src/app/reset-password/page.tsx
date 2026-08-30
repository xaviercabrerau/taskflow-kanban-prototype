"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
      <form className="modal" style={{ width: 360 }} onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>Elegir nueva contraseña</h2>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="new-password">Nueva contraseña</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirmar contraseña</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && (
            <p style={{ color: "var(--high)", fontSize: 13.5 }}>
              {error}{" "}
              <a href="/login" style={{ color: "inherit" }}>
                Volver a iniciar sesión
              </a>
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "..." : "Guardar contraseña"}
          </button>
        </div>
      </form>
    </div>
  );
}
