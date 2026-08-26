"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBoard } from "@/context/BoardContext";
import MfaSettingsModal from "./MfaSettingsModal";

// El paso de verificación en dos pasos (aal2) para cuentas que ya tienen un
// factor enrolado se resuelve en MfaAalGate, ANTES de que este componente
// (y BoardProvider) siquiera monten. Este gate solo cubre el caso restante:
// la organización exige MFA pero este usuario todavía no enroló ningún
// factor — depende de orgSettings, que solo existe dentro de BoardContext.
export default function MfaGate({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { orgSettings } = useBoard();

  const [checking, setChecking] = useState(true);
  const [needsEnrollment, setNeedsEnrollment] = useState(false);
  const [recheckToken, setRecheckToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function checkAal() {
      const { data, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      if (aalError || !data) {
        setChecking(false);
        setNeedsEnrollment(false);
        return;
      }

      const noFactorEnrolled = data.currentLevel === "aal1" && data.nextLevel === "aal1";
      setChecking(false);
      setNeedsEnrollment(noFactorEnrolled && Boolean(orgSettings?.mfaRequired));
    }

    checkAal();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSettings?.mfaRequired, recheckToken]);

  if (checking) {
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Verificando…</p>
      </div>
    );
  }

  if (needsEnrollment) {
    return (
      <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
        <div style={{ width: 520 }}>
          <p style={{ color: "var(--muted)", fontSize: 13.5, textAlign: "center", marginBottom: 12 }}>
            Tu organización requiere verificación en dos pasos. Activa un método para continuar.
          </p>
          <MfaSettingsModal onClose={() => setRecheckToken((t) => t + 1)} />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
