"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDialogA11y } from "@/hooks/useDialogA11y";

// Verifica el nivel de verificación (AAL) de la sesión ANTES de montar
// BoardProvider. Este chequeo depende únicamente de la sesión de Supabase
// Auth (no de orgSettings, que se carga vía BoardContext), por lo que puede
// bloquear el árbol completo — incluida la carga de tasks/comments/
// integrations/audit log/roles — hasta que el usuario complete el paso de
// verificación en dos pasos que Supabase ya le exige (nextLevel === "aal2").
// Sin esto, BoardProvider cargaba todos esos datos en memoria del cliente
// antes de que este gate terminara de decidir si bloquear la UI.
export default function MfaAalGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [needsChallenge, setNeedsChallenge] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // No-op onClose: this gate is mandatory and must not be dismissible via
  // Escape — only the hook's Tab focus-trap behavior is wanted here.
  useDialogA11y(formRef, () => {}, needsChallenge);

  useEffect(() => {
    let cancelled = false;

    async function checkAal() {
      const { data, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      if (aalError || !data) {
        setChecking(false);
        setNeedsChallenge(false);
        return;
      }

      const requiresStepUp = data.nextLevel === "aal2" && data.currentLevel === "aal1";
      setChecking(false);
      setNeedsChallenge(requiresStepUp);
    }

    checkAal();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!needsChallenge) return;
    let cancelled = false;

    async function prepareChallenge() {
      setPreparing(true);
      setError(null);

      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (factorsError || !factorsData) {
        setPreparing(false);
        setError(factorsError?.message ?? "No se pudo obtener el método de verificación.");
        return;
      }

      const totpFactor = factorsData.totp.find((f) => f.status === "verified");
      if (!totpFactor) {
        setPreparing(false);
        setError("No se encontró un método de verificación en dos pasos verificado.");
        return;
      }

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      });
      if (cancelled) return;
      setPreparing(false);
      if (challengeError || !challengeData) {
        setError(challengeError?.message ?? "No se pudo iniciar el desafío de verificación.");
        return;
      }

      setFactorId(totpFactor.id);
      setChallengeId(challengeData.id);
    }

    prepareChallenge();
    return () => {
      cancelled = true;
    };
  }, [needsChallenge, supabase]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId || !code.trim()) return;
    setVerifying(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: code.trim(),
    });
    setVerifying(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    setNeedsChallenge(false);
    setFactorId(null);
    setChallengeId(null);
    setCode("");
    router.refresh();
  }

  if (checking) {
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Verificando…</p>
      </div>
    );
  }

  if (needsChallenge) {
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <form
          ref={formRef}
          className="modal"
          style={{ width: 360 }}
          onSubmit={handleVerify}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mfa-aal-gate-title"
        >
          <div className="modal-head">
            <h2 id="mfa-aal-gate-title">Verificación en dos pasos</h2>
          </div>
          <div className="modal-body">
            <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 0 }}>
              Ingresa el código de 6 dígitos de tu app de autenticación para continuar.
            </p>
            <div className="field">
              <label htmlFor="mfa-aal-gate-code">Código</label>
              <input
                id="mfa-aal-gate-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
                autoFocus
                disabled={preparing || !challengeId}
              />
            </div>
            {error && <p role="alert" style={{ color: "var(--high)", fontSize: 13.5 }}>{error}</p>}
          </div>
          <div className="modal-foot">
            <span />
            <button type="submit" className="btn primary" disabled={verifying || preparing || !challengeId}>
              {verifying ? "Verificando…" : "Verificar"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
