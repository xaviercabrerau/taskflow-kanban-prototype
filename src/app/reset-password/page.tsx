"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mapa de error_code -> mensaje en español. Supabase agrega estos params a
// la URL de redirect cuando el link de recuperación es inválido/expiró/ya
// se usó — antes esta página los ignoraba por completo y mostraba el
// formulario de "elegir nueva contraseña" como si el link fuera válido; el
// usuario solo se enteraba del problema al enviar el formulario, con un
// "Auth session missing!" que no explica qué pasó ni qué hacer.
const LINK_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: "Este link de recuperación expiró.",
  access_denied: "Este link de recuperación no es válido — puede que ya se haya usado.",
};

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const linkErrorCode = searchParams.get("error_code") ?? searchParams.get("error");
  if (linkErrorCode) {
    const message = LINK_ERROR_MESSAGES[linkErrorCode] ?? "Este link de recuperación no es válido.";
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <div className="modal" style={{ width: 360 }}>
          <div className="modal-head">
            <h2>Link no válido</h2>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13.5, marginTop: 0 }}>{message}</p>
            <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
              Solicita un nuevo link desde la pantalla de inicio de sesión ("¿Olvidaste tu contraseña?").
            </p>
          </div>
          <div className="modal-foot">
            <a href="/login" className="btn primary">
              Volver a iniciar sesión
            </a>
          </div>
        </div>
      </div>
    );
  }

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

// useSearchParams() exige un límite de Suspense en el App Router (si no,
// Next.js falla el build con "should be wrapped in a suspense boundary").
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
