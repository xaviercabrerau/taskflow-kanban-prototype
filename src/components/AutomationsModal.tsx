"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationTrigger,
} from "@/lib/supabase/automations-repo";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface AutomationsModalProps {
  onClose: () => void;
  embedded?: boolean;
}

type TriggerKind = "task_created" | "status_changed" | "due_date_approaching";
type ActionKind = "move_to_column" | "set_field" | "add_comment" | "webhook";

const CONDITION_FIELD_LABEL: Record<AutomationConditionField, string> = {
  priority: "Prioridad",
  tag: "Etiqueta",
  assignee_name: "Responsable",
  title: "Título",
};

const CONDITION_OPERATOR_LABEL: Record<AutomationConditionOperator, string> = {
  eq: "es igual a",
  neq: "es distinto de",
  contains: "contiene",
};

function describeCondition(condition: AutomationCondition): string {
  return `${CONDITION_FIELD_LABEL[condition.field]} ${CONDITION_OPERATOR_LABEL[condition.operator]} "${condition.value}"`;
}

function describeTrigger(trigger: AutomationTrigger, columnLabelById: Record<string, string>): string {
  if (trigger.type === "task_created") return "Cuando se crea una tarea";
  if (trigger.type === "status_changed") {
    const label = trigger.to_column_id ? columnLabelById[trigger.to_column_id] ?? trigger.to_column_id : "cualquier columna";
    return `Cuando la tarea se mueve a "${label}"`;
  }
  return `Cuando el vencimiento está a ${trigger.days_before} día(s)`;
}

function describeAction(action: AutomationAction, columnLabelById: Record<string, string>): string {
  if (action.type === "move_to_column") {
    return `Mover a "${columnLabelById[action.column_id] ?? action.column_id}"`;
  }
  if (action.type === "set_field") {
    return `Cambiar ${action.field === "priority" ? "prioridad" : "etiqueta"} a "${action.value}"`;
  }
  if (action.type === "webhook") {
    return `Enviar webhook a ${action.url}`;
  }
  return `Agregar comentario: "${action.body}"`;
}

const SUPABASE_RPC_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/ingest_webhook_task`;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export default function AutomationsModal({ onClose, embedded = false }: AutomationsModalProps) {
  const { automationRules, createRule, toggleRule, deleteRule, isOwner, state, inboundWebhooks, createWebhook, toggleWebhook } =
    useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);
  const columnLabelById = Object.fromEntries(state.columns.map((c) => [c.id, c.title]));

  const [webhookColumnId, setWebhookColumnId] = useState(state.columns[0]?.id ?? "");
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookFeedback, setWebhookFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [revealedHookId, setRevealedHookId] = useState<string | null>(null);
  const [copiedHookId, setCopiedHookId] = useState<string | null>(null);

  function maskToken(token: string): string {
    return `${token.slice(0, 4)}${"•".repeat(Math.max(token.length - 4, 8))}`;
  }

  function handleCopyToken(id: string, token: string) {
    navigator.clipboard.writeText(token);
    setCopiedHookId(id);
    setTimeout(() => setCopiedHookId((prev) => (prev === id ? null : prev)), 2000);
  }

  async function handleCreateWebhook() {
    if (!webhookColumnId) return;
    setWebhookSaving(true);
    const result = await createWebhook(webhookColumnId);
    setWebhookSaving(false);
    setWebhookFeedback(result);
  }

  const [name, setName] = useState("");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("task_created");
  const [triggerColumnId, setTriggerColumnId] = useState(state.columns[0]?.id ?? "");
  const [daysBefore, setDaysBefore] = useState(2);
  const [actions, setActions] = useState<{ id: number; action: AutomationAction }[]>([]);
  const actionIdRef = useRef(0);
  const [actionKind, setActionKind] = useState<ActionKind>("move_to_column");
  const [actionColumnId, setActionColumnId] = useState(state.columns[0]?.id ?? "");
  const [actionField, setActionField] = useState<"priority" | "tag">("priority");
  const [actionValue, setActionValue] = useState("");
  const [actionComment, setActionComment] = useState("");
  const [actionWebhookUrl, setActionWebhookUrl] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [conditions, setConditions] = useState<{ id: number; condition: AutomationCondition }[]>([]);
  const conditionIdRef = useRef(0);
  const [conditionField, setConditionField] = useState<AutomationConditionField>("priority");
  const [conditionOperator, setConditionOperator] = useState<AutomationConditionOperator>("eq");
  const [conditionValue, setConditionValue] = useState("");

  function addCondition() {
    if (!conditionValue.trim()) return;
    const id = conditionIdRef.current++;
    setConditions((prev) => [
      ...prev,
      { id, condition: { field: conditionField, operator: conditionOperator, value: conditionValue.trim() } },
    ]);
    setConditionValue("");
  }

  function removeCondition(id: number) {
    setConditions((prev) => prev.filter((item) => item.id !== id));
  }

  function buildTrigger(): AutomationTrigger {
    if (triggerKind === "task_created") return { type: "task_created" };
    if (triggerKind === "status_changed") return { type: "status_changed", to_column_id: triggerColumnId || undefined };
    return { type: "due_date_approaching", days_before: daysBefore };
  }

  function addAction() {
    if (actionKind === "move_to_column") {
      if (!actionColumnId) return;
      const id = actionIdRef.current++;
      setActions((prev) => [...prev, { id, action: { type: "move_to_column", column_id: actionColumnId } }]);
    } else if (actionKind === "set_field") {
      if (!actionValue.trim()) return;
      const id = actionIdRef.current++;
      setActions((prev) => [
        ...prev,
        { id, action: { type: "set_field", field: actionField, value: actionValue.trim() } },
      ]);
      setActionValue("");
    } else if (actionKind === "add_comment") {
      if (!actionComment.trim()) return;
      const id = actionIdRef.current++;
      setActions((prev) => [...prev, { id, action: { type: "add_comment", body: actionComment.trim() } }]);
      setActionComment("");
    } else {
      const url = actionWebhookUrl.trim();
      if (!url.startsWith("https://")) return;
      const id = actionIdRef.current++;
      setActions((prev) => [...prev, { id, action: { type: "webhook", url } }]);
      setActionWebhookUrl("");
    }
  }

  function removeAction(id: number) {
    setActions((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || actions.length === 0) return;
    setSaving(true);
    const result = await createRule({
      name: name.trim(),
      trigger: buildTrigger(),
      conditions: conditions.map((item) => item.condition),
      actions: actions.map((item) => item.action),
    });
    setSaving(false);
    setFeedback(result);
    if (result.ok) {
      setName("");
      setConditions([]);
      setActions([]);
    }
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 480 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="automations-modal-title"
      >
        <div className="modal-head">
          <h2 id="automations-modal-title">Automatizaciones</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 16 }}>
            {automationRules.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Todavía no hay reglas configuradas.</p>
            )}
            {automationRules.map((rule) => (
              <div
                key={rule.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 8,
                  opacity: rule.isActive ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{rule.name}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    {isOwner && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          title={rule.isActive ? "Desactivar" : "Activar"}
                          onClick={() => toggleRule(rule.id, !rule.isActive)}
                        >
                          {rule.isActive ? "⏸️" : "▶️"}
                        </button>
                        <button type="button" className="icon-btn" title="Eliminar" onClick={() => deleteRule(rule.id)}>
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                  {describeTrigger(rule.trigger, columnLabelById)}
                </div>
                {rule.conditions.length > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    Si {rule.conditions.map(describeCondition).join(" y ")}
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  → {rule.actions.map((a) => describeAction(a, columnLabelById)).join("; ")}
                </div>
              </div>
            ))}
          </div>

          {isOwner && (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="rule-name">Nombre de la regla</label>
                <input
                  id="rule-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Avisar antes del vencimiento"
                  required
                />
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="trigger-kind">Disparador</label>
                <select id="trigger-kind" value={triggerKind} onChange={(e) => setTriggerKind(e.target.value as TriggerKind)}>
                  <option value="task_created">Tarea creada</option>
                  <option value="status_changed">Tarea movida a columna</option>
                  <option value="due_date_approaching">Vencimiento próximo</option>
                </select>
              </div>

              {triggerKind === "status_changed" && (
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor="trigger-column">Columna destino</label>
                  <select id="trigger-column" value={triggerColumnId} onChange={(e) => setTriggerColumnId(e.target.value)}>
                    {state.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {triggerKind === "due_date_approaching" && (
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor="trigger-days">Días antes del vencimiento</label>
                  <input
                    id="trigger-days"
                    type="number"
                    min={1}
                    value={daysBefore}
                    onChange={(e) => setDaysBefore(Number(e.target.value))}
                  />
                </div>
              )}

              <div className="field" style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <label>Condiciones (opcional, se cumplen todas)</label>
                {conditions.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {conditions.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 12.5,
                          padding: "4px 0",
                        }}
                      >
                        <span>{describeCondition(item.condition)}</span>
                        <button type="button" className="icon-btn" onClick={() => removeCondition(item.id)} title="Quitar">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <select
                    value={conditionField}
                    onChange={(e) => setConditionField(e.target.value as AutomationConditionField)}
                  >
                    <option value="priority">Prioridad</option>
                    <option value="tag">Etiqueta</option>
                    <option value="assignee_name">Responsable</option>
                    <option value="title">Título</option>
                  </select>
                  <select
                    value={conditionOperator}
                    onChange={(e) => setConditionOperator(e.target.value as AutomationConditionOperator)}
                  >
                    <option value="eq">es igual a</option>
                    <option value="neq">es distinto de</option>
                    <option value="contains">contiene</option>
                  </select>
                  <input
                    type="text"
                    value={conditionValue}
                    onChange={(e) => setConditionValue(e.target.value)}
                    placeholder="valor"
                    style={{ minWidth: 120 }}
                  />
                  <button type="button" className="btn" onClick={addCondition}>
                    + Agregar condición
                  </button>
                </div>
              </div>

              <div className="field" style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <label>Acciones</label>
                {actions.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {actions.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 12.5,
                          padding: "4px 0",
                        }}
                      >
                        <span>{describeAction(item.action, columnLabelById)}</span>
                        <button type="button" className="icon-btn" onClick={() => removeAction(item.id)} title="Quitar">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <select value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionKind)}>
                    <option value="move_to_column">Mover a columna</option>
                    <option value="set_field">Cambiar prioridad/etiqueta</option>
                    <option value="add_comment">Agregar comentario</option>
                    <option value="webhook">Enviar webhook</option>
                  </select>

                  {actionKind === "move_to_column" && (
                    <select value={actionColumnId} onChange={(e) => setActionColumnId(e.target.value)}>
                      {state.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  )}

                  {actionKind === "set_field" && (
                    <>
                      <select value={actionField} onChange={(e) => setActionField(e.target.value as "priority" | "tag")}>
                        <option value="priority">Prioridad</option>
                        <option value="tag">Etiqueta</option>
                      </select>
                      <input
                        type="text"
                        value={actionValue}
                        onChange={(e) => setActionValue(e.target.value)}
                        placeholder={actionField === "priority" ? "high / medium / low" : "urgente"}
                        style={{ minWidth: 120 }}
                      />
                    </>
                  )}

                  {actionKind === "add_comment" && (
                    <input
                      type="text"
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                      placeholder="Texto del comentario"
                      style={{ minWidth: 160 }}
                    />
                  )}

                  {actionKind === "webhook" && (
                    <input
                      type="url"
                      value={actionWebhookUrl}
                      onChange={(e) => setActionWebhookUrl(e.target.value)}
                      placeholder="https://ejemplo.com/webhook"
                      style={{ minWidth: 220 }}
                    />
                  )}

                  <button type="button" className="btn" onClick={addAction}>
                    + Agregar acción
                  </button>
                </div>
              </div>

              {feedback && (
                <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 12 }}>
                  {feedback.message}
                </p>
              )}

              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={saving || actions.length === 0}>
                  {saving ? "Guardando…" : "Guardar regla"}
                </button>
              </div>
            </form>
          )}

          {isOwner && (
            <div className="field" style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
              <label>Webhooks entrantes (n8n / sistemas externos)</label>
              <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 2, marginBottom: 8 }}>
                Cualquier sistema con la URL y el token puede crear tareas en la columna indicada.
              </p>

              {inboundWebhooks.length === 0 && (
                <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Todavía no hay webhooks entrantes.</p>
              )}
              {inboundWebhooks.map((hook) => (
                <div
                  key={hook.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 8,
                    opacity: hook.isActive ? 1 : 0.55,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                      → {columnLabelById[hook.columnId] ?? hook.columnId}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      title={hook.isActive ? "Desactivar" : "Activar"}
                      onClick={() => toggleWebhook(hook.id, !hook.isActive)}
                    >
                      {hook.isActive ? "⏸️" : "▶️"}
                    </button>
                  </div>
                  {hook.isActive && (
                    <>
                      {hook.token ? (
                        <>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                setRevealedHookId((prev) => (prev === hook.id ? null : hook.id))
                              }
                            >
                              {revealedHookId === hook.id ? "Ocultar token" : "Mostrar token"}
                            </button>
                            <button type="button" className="btn" onClick={() => handleCopyToken(hook.id, hook.token!)}>
                              {copiedHookId === hook.id ? "¡Copiado!" : "Copiar comando curl"}
                            </button>
                          </div>
                          <p style={{ color: "var(--high)", fontSize: 12, marginTop: 6 }}>
                            Copia el token ahora — por seguridad, no se puede volver a mostrar después de cerrar este panel.
                          </p>
                          <pre
                            style={{
                              marginTop: 8,
                              fontSize: 11,
                              background: "var(--surface-2, #1a1a1a10)",
                              borderRadius: 6,
                              padding: 8,
                              overflowX: "auto",
                              whiteSpace: "pre",
                            }}
                          >
{`curl -X POST '${SUPABASE_RPC_URL}' \\
  -H 'apikey: ${SUPABASE_ANON_KEY}' \\
  -H 'Content-Type: application/json' \\
  -d '{"p_token": "${revealedHookId === hook.id ? hook.token : maskToken(hook.token)}", "p_title": "Título de la tarea"}'`}
                          </pre>
                        </>
                      ) : (
                        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>
                          Token oculto por seguridad. Si lo perdiste, borra este webhook y crea uno nuevo.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <select value={webhookColumnId} onChange={(e) => setWebhookColumnId(e.target.value)}>
                  {state.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={handleCreateWebhook} disabled={webhookSaving}>
                  {webhookSaving ? "Creando…" : "+ Generar webhook"}
                </button>
              </div>

              {webhookFeedback && (
                <p style={{ color: webhookFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>
                  {webhookFeedback.message}
                </p>
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
