"use client";

import { createClient } from "@/lib/supabase/client";

interface SsoLoginSectionProps {
  domain: string;
  onError: (message: string) => void;
}

export default function SsoLoginSection({ domain, onError }: SsoLoginSectionProps) {
  async function handleClick() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithSSO({ domain });
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    onError(error?.message ?? "No se encontró un proveedor SSO para este dominio.");
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn" onClick={handleClick}>
        Continuar con SSO empresarial
      </button>
    </div>
  );
}
