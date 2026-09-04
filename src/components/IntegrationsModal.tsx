"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
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
  crm_generic: "CRM (genérico)",
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
  const { saveIntegration, deleteIntegration } = useAdminData();
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

// Config multi-campo de crm_generic (base_url/endpoints/field_mapping) — no
// encaja en el patrón de un solo input de CONFIG_FIELD/ProviderCard arriba,
// así que tiene su propia card. Ver docs/plans/2026-09-03-crm-integration-design.md.
interface CrmGenericConfig {
  base_url: string;
  auth_header: string;
  create_endpoint: string;
  update_endpoint: string;
  response_id_field: string;
  field_mapping: string; // JSON como texto en el textarea; se parsea al guardar.
}

const CRM_GENERIC_DEFAULTS: CrmGenericConfig = {
  base_url: "",
  auth_header: "Authorization",
  create_endpoint: "/tickets",
  update_endpoint: "/tickets/{external_id}",
  response_id_field: "id",
  field_mapping: '{\n  "title": "subject",\n  "description": "body",\n  "priority": "priority",\n  "column_title": "status"\n}',
};

function crmGenericConfigFromIntegration(integration: Integration | undefined): CrmGenericConfig {
  const config = integration?.config ?? {};
  return {
    base_url: typeof config.base_url === "string" ? config.base_url : CRM_GENERIC_DEFAULTS.base_url,
    auth_header: typeof config.auth_header === "string" ? config.auth_header : CRM_GENERIC_DEFAULTS.auth_header,
    create_endpoint: typeof config.create_endpoint === "string" ? config.create_endpoint : CRM_GENERIC_DEFAULTS.create_endpoint,
    update_endpoint: typeof config.update_endpoint === "string" ? config.update_endpoint : CRM_GENERIC_DEFAULTS.update_endpoint,
    response_id_field: typeof config.response_id_field === "string" ? config.response_id_field : CRM_GENERIC_DEFAULTS.response_id_field,
    field_mapping:
      config.field_mapping && typeof config.field_mapping === "object"
        ? JSON.stringify(config.field_mapping, null, 2)
        : CRM_GENERIC_DEFAULTS.field_mapping,
  };
}

function CrmGenericCard({ integration }: { integration: Integration | undefined }) {
  const { saveIntegration, deleteIntegration } = useAdminData();
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<CrmGenericConfig>(() => crmGenericConfigFromIntegration(integration));
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(integration?.isActive ?? false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const hasCredential = integration?.hasCredential ?? false;

  function updateField<K extends keyof CrmGenericConfig>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // field_mapping se valida como JSON antes de guardar — un objeto plano
  // { "campo_taskflow": "campo_crm" }, consumido tal cual por
  // execute_automation_rules() (jsonb_each_text sobre config->'field_mapping').
  function buildConfig(): { config: Record<string, Json>; error: string | null } {
    let mapping: unknown;
    try {
      mapping = JSON.parse(form.field_mapping || "{}");
    } catch {
      return { config: {}, error: "El mapeo de campos no es JSON válido." };
    }
    if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
      return { config: {}, error: "El mapeo de campos debe ser un objeto JSON plano, ej. { \"title\": \"subject\" }." };
    }
    return {
      config: {
        base_url: form.base_url.trim(),
        auth_header: form.auth_header.trim() || "Authorization",
        create_endpoint: form.create_endpoint.trim(),
        update_endpoint: form.update_endpoint.trim(),
        response_id_field: form.response_id_field.trim() || "id",
        field_mapping: mapping as Json,
      },
      error: null,
    };
  }

  async function handleToggleActive() {
    const { config, error } = buildConfig();
    if (error) {
      setFeedback({ ok: false, message: error });
      return;
    }
    const nextActive = !isActive;
    setSaving(true);
    const result = await saveIntegration("crm_generic", config, null, nextActive);
    setSaving(false);
    setFeedback(result);
    if (result.ok) setIsActive(nextActive);
  }

  async function handleSave() {
    const { config, error } = buildConfig();
    if (error) {
      setFeedback({ ok: false, message: error });
      return;
    }
    setSaving(true);
    const result = await saveIntegration("crm_generic", config, secret.trim() === "" ? null : secret, isActive);
    setSaving(false);
    setFeedback(result);
    if (result.ok) setSecret("");
  }

  async function handleClearSecret() {
    const confirmed = window.confirm("¿Borrar el secreto guardado para CRM (genérico)? Esta acción no se puede deshacer.");
    if (!confirmed) return;
    const { config, error } = buildConfig();
    if (error) {
      setFeedback({ ok: false, message: error });
      return;
    }
    setSaving(true);
    const result = await saveIntegration("crm_generic", config, "", isActive);
    setSaving(false);
    setFeedback(result);
  }

  async function handleDelete() {
    if (!integration) return;
    const confirmed = window.confirm("¿Eliminar la integración de CRM (genérico)? Se borrará también su secreto guardado.");
    if (!confirmed) return;
    setSaving(true);
    const result = await deleteIntegration(integration.id);
    setSaving(false);
    setFeedback(result);
    if (result.ok) {
      setExpanded(false);
      setForm(CRM_GENERIC_DEFAULTS);
      setSecret("");
      setIsActive(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{PROVIDER_LABELS.crm_generic}</span>
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
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{hasCredential ? "configurada" : "sin configurar"}</span>
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

      {expanded && (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0 }}>
            Sincroniza tareas con tickets/casos de un CRM externo (crea/actualiza vía la acción &ldquo;Sincronizar con
            CRM&rdquo; en Automatizaciones). Usa esta integración como la fuente de <code>integration_id</code> al crear esa
            regla.
          </p>

          <div className="field">
            <label htmlFor="crm-base-url">URL base del CRM</label>
            <input
              id="crm-base-url"
              type="text"
              value={form.base_url}
              onChange={(e) => updateField("base_url", e.target.value)}
              placeholder="https://api.micrm.com"
            />
          </div>

          <div className="field-row" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="crm-create-endpoint">Endpoint de creación</label>
              <input
                id="crm-create-endpoint"
                type="text"
                value={form.create_endpoint}
                onChange={(e) => updateField("create_endpoint", e.target.value)}
                placeholder="/tickets"
              />
            </div>
            <div className="field">
              <label htmlFor="crm-update-endpoint">Endpoint de actualización</label>
              <input
                id="crm-update-endpoint"
                type="text"
                value={form.update_endpoint}
                onChange={(e) => updateField("update_endpoint", e.target.value)}
                placeholder="/tickets/{external_id}"
              />
              <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 0" }}>
                <code>{"{external_id}"}</code> se reemplaza por el id del ticket vinculado.
              </p>
            </div>
          </div>

          <div className="field-row" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="crm-auth-header">Header de autenticación</label>
              <input
                id="crm-auth-header"
                type="text"
                value={form.auth_header}
                onChange={(e) => updateField("auth_header", e.target.value)}
                placeholder="Authorization"
              />
            </div>
            <div className="field">
              <label htmlFor="crm-response-id-field">Campo del id en la respuesta</label>
              <input
                id="crm-response-id-field"
                type="text"
                value={form.response_id_field}
                onChange={(e) => updateField("response_id_field", e.target.value)}
                placeholder="id"
              />
            </div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="crm-field-mapping">Mapeo de campos (JSON)</label>
            <textarea
              id="crm-field-mapping"
              value={form.field_mapping}
              onChange={(e) => updateField("field_mapping", e.target.value)}
              rows={6}
              style={{ fontFamily: "monospace", fontSize: 12.5 }}
              placeholder={CRM_GENERIC_DEFAULTS.field_mapping}
            />
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 0" }}>
              Claves permitidas: <code>title</code>, <code>description</code>, <code>priority</code>,{" "}
              <code>column_title</code>. El valor es el nombre del campo correspondiente en el CRM.
            </p>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="crm-secret">API key / token del CRM</label>
            <input
              id="crm-secret"
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
                  style={{ background: "none", border: "none", padding: 0, color: "var(--high)", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}
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
      )}
    </div>
  );
}

export default function IntegrationsModal({ onClose, embedded = false }: IntegrationsModalProps) {
  const { isOwner } = useBoard();
  const { integrations } = useAdminData();
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
              {INTEGRATION_PROVIDERS.map((provider) =>
                provider === "crm_generic" ? (
                  <CrmGenericCard key={provider} integration={byProvider.get(provider)} />
                ) : (
                  <ProviderCard key={provider} provider={provider} integration={byProvider.get(provider)} />
                )
              )}
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
