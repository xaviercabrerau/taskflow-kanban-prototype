"use client";

import { useState } from "react";
import { useAdminData } from "@/context/AdminDataContext";

interface TaskForwardEmailSectionProps {
  taskId: string;
}

export default function TaskForwardEmailSection({ taskId }: TaskForwardEmailSectionProps) {
  const { integrations } = useAdminData();
  const googleConnected = integrations.some((i) => i.provider === "google" && i.hasCredential && i.isActive);

  const [forwardEmailOpen, setForwardEmailOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardNote, setForwardNote] = useState("");
  const [forwardingEmail, setForwardingEmail] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleForwardEmail() {
    const to = forwardTo.trim();
    if (!to || forwardingEmail) return;
    setForwardingEmail(true);
    setForwardResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/forward-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, note: forwardNote.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo enviar el email.");
      }
      setForwardResult({ ok: true, message: `Tarea reenviada a ${to}.` });
      setForwardTo("");
      setForwardNote("");
    } catch (err) {
      setForwardResult({
        ok: false,
        message: err instanceof Error ? err.message : "No se pudo enviar el email.",
      });
    } finally {
      setForwardingEmail(false);
    }
  }

  if (!googleConnected) return null;

  return (
    <div className="field task-section">
      <label>Reenviar por email</label>
      {!forwardEmailOpen ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setForwardEmailOpen(true);
            setForwardResult(null);
          }}
        >
          📧 Reenviar por email
        </button>
      ) : (
        // Nota: no puede ser un <form> — TaskModal ya está envuelto en el
        // <form> principal de guardar tarea, y un <form> anidado es HTML
        // inválido: el navegador lo descarta y el botón "Enviar" terminaba
        // disparando el submit del formulario externo (guardaba y cerraba
        // el modal sin llamar a handleForwardEmail).
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="comment-input-wrap" style={{ marginTop: 0 }}>
            <input
              id="forward-email-to"
              name="forwardEmailTo"
              type="email"
              value={forwardTo}
              onChange={(e) => setForwardTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleForwardEmail();
                }
              }}
              placeholder="Email del destinatario"
              disabled={forwardingEmail}
              required
            />
          </div>
          <textarea
            id="forward-email-note"
            name="forwardEmailNote"
            value={forwardNote}
            onChange={(e) => setForwardNote(e.target.value)}
            placeholder="Nota (opcional)"
            disabled={forwardingEmail}
            rows={2}
            style={{ width: "100%" }}
          />
          <div>
            <button
              type="button"
              className="btn primary"
              onClick={handleForwardEmail}
              disabled={!forwardTo.trim() || forwardingEmail}
            >
              {forwardingEmail ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
      {forwardResult && (
        <p
          role={forwardResult.ok ? "status" : "alert"}
          className={forwardResult.ok ? undefined : "field-error"}
          style={forwardResult.ok ? { color: "var(--low)", fontSize: 13.5 } : undefined}
        >
          {forwardResult.message}
        </p>
      )}
    </div>
  );
}
