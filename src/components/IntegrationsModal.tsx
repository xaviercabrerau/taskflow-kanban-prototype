"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import {
  INTEGRATION_PROVIDERS,
  type Integration,
  type IntegrationProvider,
} from "@/lib/supabase/integrations-repo";
import type { Json } from "@/lib/supabase/database.types";

interface IntegrationsModalProps {
  onClose: () => void;
  embedded?: boolean;
}

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  n8n: "n8n",
  openai: "OpenAI",
  anthropic: "Anthropic",
  github: "GitHub",
  resend: "Email (Resend)",
  gmail_inbound: "Gmail (entrada)",
  google: "Google Workspace (Calendar, Drive, Gmail)",
};

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
}

const CONFIG_FIELD: Partial<Record<IntegrationProvider, ConfigField>> = {
  slack: { key: "webhookUrl", label: "Webhook URL / endpoint", placeholder: "https://..." },
  teams: { key: "webhookUrl", label: "Webhook URL / endpoint", placeholder: "https://..." },
  zoom: { key: "webhookUrl", label: "Webhook URL / endpoint", placeholder: "https://..." },
  n8n: { key: "webhookUrl", label: "Webhook URL / endpoint", placeholder: "https://..." },
  resend: { key: "fromEmail", label: "Email remitente", placeholder: "notificaciones@tuempresa.com" },
  gmail_inbound: {
    key: "routingEmail",
    label: "Casilla de entrada (routing)",
    placeholder: "tareas@tuempresa.com",
  },
};

function secretLabel(provider: IntegrationProvider): string {
  if (provider === "openai" || provider === "anthropic" || provider === "resend") return "API key";
  if (provider === "github") return "Token";
  if (provider === "gmail_inbound") return "Webhook secret (Pub/Sub)";
  return "Secreto";
}

interface ProviderCardProps {
  provider: IntegrationProvider;
  integration: Integration | undefined;
}

function ProviderCard({ provider, integration }: ProviderCardProps) {
  const { saveIntegration, deleteIntegration } = useBoard();
  const [expanded, setExpanded] = useState(false);
  const configField = CONFIG_FIELD[provider];
  const [configValue, setConfigValue] = useState(
    configField && typeof integration?.config?.[configField.key] === "string"
      ? (integration.config[configField.key] as string)
      : ""
  );
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(integration?.isActive ?? false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const hasCredential = integration?.hasCredential ?? false;

  function buildConfig(): Record<string, Json> {
    return configField ? { [configField.key]: configValue.trim() } : {};
  }

  async function handleToggleActive() {
    const nextActive = !isActive;
    setSaving(true);
    const result = await saveIntegration(provider, buildConfig(), null, nextActive);
    setSaving(false);
    setFeedback(result);
    if (result.ok) setIsActive(nextActive);
  }

  async function handleSave() {
    setSaving(true);
    const result = await saveIntegration(
      provider,
      buildConfig(),
      secret.trim() === "" ? null : secret,
      isActive
    );
    setSaving(false);
    setFeedback(result);
    if (result.ok) setSecret("");
  }

  async function handleClearSecret() {
    const confirmed = window.confirm(
      `¿Borrar el secreto guardado para ${PROVIDER_LABELS[provider]}? Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;
    setSaving(true);
    const result = await saveIntegration(provider, buildConfig(), "", isActive);
    setSaving(false);
    setFeedback(result);
  }

  async function handleDelete() {
    if (!integration) return;
    const confirmed = window.confirm(
      `¿Eliminar la integración de ${PROVIDER_LABELS[provider]}? Se borrará también su secreto guardado.`
    );
    if (!confirmed) return;
    setSaving(true);
    const result = await deleteIntegration(integration.id);
    setSaving(false);
    setFeedback(result);
    if (result.ok) {
      setExpanded(false);
      setConfigValue("");
      setSecret("");
      setIsActive(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{PROVIDER_LABELS[provider]}</span>
          <span
            style={{
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 4,
              background: isActive ? "var(--accent)" : "var(--border)",
              color: isActive ? "#fff" : "var(--muted)",
            }}
          >
            {isActive ? "Activa" : "Inactiva"}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {hasCredential ? "configurada" : "sin configurar"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn" disabled={saving} onClick={handleToggleActive}>
            {isActive ? "Desactivar" : "Activar"}
          </button>
          <button type="button" className="btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Cerrar" : integration ? "Editar" : "Configurar"}
          </button>
        </div>
      </div>

      {expanded && provider === "google" ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0 }}>
            Conecta una cuenta de Google Workspace para sincronizar las fechas de vencimiento con
            Google Calendar, adjuntar archivos de Google Drive por enlace, y enviar correos desde
            Gmail. Requiere que un administrador haya creado un proyecto en Google Cloud con las
            APIs de Calendar/Drive/Gmail habilitadas — si esa configuración todavía no existe, el
            botón de abajo mostrará un error explicándolo.
          </p>
          {hasCredential ? (
            <>
              <p style={{ fontSize: 13.5, marginTop: 10 }}>
                Cuenta conectada
                {typeof integration?.config?.connectedEmail === "string"
                  ? `: ${integration.config.connectedEmail}`
                  : ""}
              </p>
              {feedback && (
                <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                  {feedback.message}
                </p>
              )}
              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <button type="button" className="btn" disabled={saving} onClick={handleDelete}>
                  Desconectar
                </button>
                <a href="/api/integrations/google/connect" className="btn primary">
                  Reconectar
                </a>
              </div>
            </>
          ) : (
            <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
              <span />
              <a href="/api/integrations/google/connect" className="btn primary">
                Conectar cuenta de Google
              </a>
            </div>
          )}
        </div>
      ) : expanded ? (
        <div style={{ marginTop: 10 }}>
          {configField && (
            <div className="field">
              <label htmlFor={`config-${provider}`}>{configField.label}</label>
              <input
                id={`config-${provider}`}
                type="text"
                value={configValue}
                onChange={(e) => setConfigValue(e.target.value)}
                placeholder={configField.placeholder}
              />
            </div>
          )}

          {provider === "gmail_inbound" && (
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
              Esto guarda la casilla de entrada y el secreto para verificar el webhook de Pub/Sub. Activar la
              recepción real de respuestas por Gmail requiere que un administrador configure OAuth y Google Cloud
              Pub/Sub en un Google Workspace real, fuera de esta app (igual que con SSO). El endpoint{" "}
              <code>/api/gmail-webhook</code> ya existe pero responde &ldquo;no configurado&rdquo; hasta entonces.
            </p>
          )}

          <div className="field" style={{ marginTop: configField ? 10 : 0 }}>
            <label htmlFor={`secret-${provider}`}>{secretLabel(provider)}</label>
            <input
              id={`secret-${provider}`}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={hasCredential ? "••••••••" : ""}
            />
            {hasCredential ? (
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                Dejar en blanco para no cambiar el secreto guardado.{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleClearSecret}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--high)",
                    fontSize: 12,
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  Borrar secreto
                </button>
              </p>
            ) : null}
          </div>

          {feedback && (
            <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
              {feedback.message}
            </p>
          )}

          <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
            {integration ? (
              <button type="button" className="btn" disabled={saving} onClick={handleDelete}>
                Eliminar integración
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="btn primary" disabled={saving} onClick={handleSave}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function IntegrationsModal({ onClose, embedded = false }: IntegrationsModalProps) {
  const { integrations, isOwner } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const byProvider = new Map(integrations.map((i) => [i.provider, i]));

  const panel = (
    <div
      className={embedded ? "admin-panel" : "modal"}
      style={embedded ? undefined : { width: 560 }}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
      ref={modalRef}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby="integrations-modal-title"
    >
        <div className="modal-head">
          <h2 id="integrations-modal-title">Integraciones de terceros</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          {!isOwner ? (
            <>
              <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 16 }}>
                Solo el propietario puede configurar integraciones.
              </p>
              <div className="field">
                {INTEGRATION_PROVIDERS.map((provider) => {
                  const integration = byProvider.get(provider);
                  return (
                    <div
                      key={provider}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{PROVIDER_LABELS[provider]}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: integration?.isActive ? "var(--accent)" : "var(--border)",
                            color: integration?.isActive ? "#fff" : "var(--muted)",
                          }}
                        >
                          {integration?.isActive ? "Activa" : "Inactiva"}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          {integration?.hasCredential ? "configurada" : "sin configurar"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="field">
              {INTEGRATION_PROVIDERS.map((provider) => (
                <ProviderCard key={provider} provider={provider} integration={byProvider.get(provider)} />
              ))}
            </div>
          )}
        </div>
    </div>
  );

  if (embedded) return panel;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {panel}
    </div>
  );
}
