"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SsoLoginSection from "@/components/SsoLoginSection";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailDomain = useMemo(() => {
    const at = email.indexOf("@");
    if (at === -1 || at === email.length - 1) return null;
    return email.slice(at + 1).trim();
  }, [email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    if (mode === "forgot") {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      // Same message whether or not the email has an account — avoids
      // leaking which emails are registered.
      setInfo(
        "Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña."
      );
      return;
    }
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      router.push("/");
      router.refresh();
      return;
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (!data.session) {
      setInfo("Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
      <form className="modal" style={{ width: 360 }} onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>
            {mode === "signin"
              ? "Iniciar sesión"
              : mode === "signup"
                ? "Crear cuenta"
                : "Recuperar contraseña"}
          </h2>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          {mode !== "forgot" && (
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}
          {error && (
            <p style={{ color: "var(--high)", fontSize: 13.5 }}>{error}</p>
          )}
          {info && (
            <p style={{ color: "var(--low)", fontSize: 13.5 }}>{info}</p>
          )}
          {mode === "signin" && emailDomain && (
            <SsoLoginSection domain={emailDomain} onError={setError} />
          )}
          {mode === "signin" && (
            <button
              type="button"
              className="link-button"
              style={{ fontSize: 13, marginTop: 4 }}
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode("forgot");
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(null);
              setInfo(null);
              setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup");
            }}
          >
            {mode === "signin" ? "Crear cuenta nueva" : "Ya tengo cuenta"}
          </button>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading
              ? "..."
              : mode === "signin"
                ? "Entrar"
                : mode === "signup"
                  ? "Registrarme"
                  : "Enviar enlace"}
          </button>
        </div>
      </form>
    </div>
  );
}
