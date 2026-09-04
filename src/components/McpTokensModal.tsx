"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface McpTokensModalProps {
  onClose: () => void;
  embedded?: boolean;
}

type ClientKind = "claude_chat" | "claude_cowork" | "claude_desktop" | "claude_code" | "other";

const CLIENT_LABEL: Record<ClientKind, string> = {
  claude_chat: "Claude (chat web)",
  claude_cowork: "Claude Cowork",
  claude_desktop: "Claude Desktop",
  claude_code: "Claude Code",
  other: "Otro cliente MCP",
};

const TOKEN_SCOPES = ["tasks:read", "tasks:write", "comments:write"];

function formatDate(iso: string | null): string {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleString();
}

export default function McpTokensModal({ onClose, embedded = false }: McpTokensModalProps) {
  const { isOwner } = useBoard();
  const { mcpSessions, createMcpToken, revokeMcpToken, orgSettings, updateOrgSettings } = useAdminData();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [name, setName] = useState("");
  const [client, setClient] = useState<ClientKind>("claude_desktop");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [justCreated, setJustCreated] = useState<{ token: string; client: ClientKind } | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingMcp, setTogglingMcp] = useState(false);

  const mcpTokensEnabled = orgSettings?.mcpTokensEnabled ?? true;

  async function handleToggleMcpEnabled() {
    setTogglingMcp(true);
    await updateOrgSettings({ mcpTokensEnabled: !mcpTokensEnabled });
    setTogglingMcp(false);
  }

  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";

  function configSnippet(token: string): string {
    const config = {
      mcpServers: {
        taskflow: {
          url: `${appOrigin}/api/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFeedback(null);
    const result = await createMcpToken(client, name.trim(), TOKEN_SCOPES);
    setSaving(false);
    if (result.ok) {
      setJustCreated({ token: result.token, client });
      setName("");
      setCopied(false);
    } else {
      setFeedback({ ok: false, message: result.message });
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleRevoke(id: string, sessionName: string) {
    const confirmed = window.confirm(`¿Revocar el token "${sessionName}"? Esta acción no se puede deshacer.`);
    if (!confirmed) return;
    revokeMcpToken(id);
  }

  function dismissJustCreated() {
    setJustCreated(null);
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 480 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="mcp-tokens-modal-title"
      >
        <div className="modal-head">
          <h2 id="mcp-tokens-modal-title">Tokens de acceso (MCP)</h2>
          {!embedded && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                dismissJustCreated();
                onClose();
              }}
              aria-label="Cerrar"
            >
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
            Genera tokens de acceso personal para conectar clientes MCP (Claude Desktop, Claude Code, u otros) a este
            workspace de TaskFlow.
          </p>

          {isOwner && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 16,
              }}
            >
              <div>
                <p style={{ fontWeight: 600, fontSize: 13.5, margin: 0 }}>Permitir tokens MCP</p>
                <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 2, marginBottom: 0 }}>
                  Si lo apagas, ningún miembro (ni tú) podrá crear tokens nuevos, y los ya emitidos dejan de
                  funcionar de inmediato.
                </p>
              </div>
              <button type="button" className="btn" onClick={handleToggleMcpEnabled} disabled={togglingMcp}>
                {togglingMcp ? "…" : mcpTokensEnabled ? "Desactivar" : "Activar"}
              </button>
            </div>
          )}

          {!mcpTokensEnabled && (
            <p style={{ color: "var(--high)", fontSize: 13.5, marginBottom: 16 }}>
              El propietario de esta organización deshabilitó la creación de tokens MCP.
            </p>
          )}

          {justCreated && (
            <div
              style={{
                border: "1px solid var(--accent)",
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 16,
                background: "var(--surface-2, #1a1a1a10)",
              }}
            >
              <p style={{ fontWeight: 600, fontSize: 13.5, margin: 0 }}>Token creado</p>
              <p style={{ color: "var(--high)", fontSize: 12.5, marginTop: 4, marginBottom: 8 }}>
                Copia este token ahora: no se volverá a mostrar.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code
                  style={{
                    flex: 1,
                    fontSize: 12,
                    background: "var(--surface-2, #1a1a1a10)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    overflowX: "auto",
                    whiteSpace: "nowrap",
                  }}
                >
                  {justCreated.token}
                </code>
                <button type="button" className="btn" onClick={() => handleCopy(justCreated.token)}>
                  {copied ? "¡Copiado!" : "Copiar"}
                </button>
              </div>

              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, marginBottom: 4 }}>
                Configuración para <code>claude_desktop_config.json</code>:
              </p>
              <pre
                style={{
                  fontSize: 11,
                  background: "var(--surface-2, #1a1a1a10)",
                  borderRadius: 6,
                  padding: 8,
                  overflowX: "auto",
                  whiteSpace: "pre",
                }}
              >
                {configSnippet(justCreated.token)}
              </pre>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" className="btn" onClick={dismissJustCreated}>
                  Listo
                </button>
              </div>
            </div>
          )}

          <div className="field" style={{ marginBottom: 16 }}>
            {mcpSessions.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Todavía no hay tokens generados.</p>
            )}
            {mcpSessions.map((session) => (
              <div
                key={session.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 8,
                  opacity: session.revokedAt ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{session.name}</span>
                  {session.revokedAt ? (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      Revocado
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleRevoke(session.id, session.name)}
                    >
                      Revocar
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                  {CLIENT_LABEL[session.client as ClientKind] ?? session.client}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Creado: {formatDate(session.createdAt)} · Último uso: {formatDate(session.lastUsedAt)}
                </div>
              </div>
            ))}
          </div>

          {mcpTokensEnabled && (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="mcp-token-name">Nombre del token</label>
                <input
                  id="mcp-token-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: MacBook de Ana"
                  required
                />
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="mcp-token-client">Cliente</label>
                <select id="mcp-token-client" value={client} onChange={(e) => setClient(e.target.value as ClientKind)}>
                  <option value="claude_chat">Claude (chat web)</option>
                  <option value="claude_cowork">Claude Cowork</option>
                  <option value="claude_desktop">Claude Desktop</option>
                  <option value="claude_code">Claude Code</option>
                  <option value="other">Otro cliente MCP</option>
                </select>
              </div>

              {feedback && (
                <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                  {feedback.message}
                </p>
              )}

              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Creando…" : "+ Generar token"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        dismissJustCreated();
        onClose();
      }}
    >
      {panel}
    </div>
  );
}
