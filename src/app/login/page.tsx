"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SsoLoginSection from "@/components/SsoLoginSection";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
          <h2>{mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}</h2>
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
          {error && (
            <p style={{ color: "var(--high)", fontSize: 13.5 }}>{error}</p>
          )}
          {info && (
            <p style={{ color: "var(--low)", fontSize: 13.5 }}>{info}</p>
          )}
          {emailDomain && <SsoLoginSection domain={emailDomain} onError={setError} />}
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Crear cuenta nueva" : "Ya tengo cuenta"}
          </button>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "..." : mode === "signin" ? "Entrar" : "Registrarme"}
          </button>
        </div>
      </form>
    </div>
  );
}
