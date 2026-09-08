"use client";

import { useEffect, useRef, useState } from "react";
import { ColumnData, Priority, Task, dueBadge } from "@/lib/types";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { OrgMember } from "@/lib/supabase/members-repo";
import { generateTempId } from "@/lib/tempId";
import { fetchTaskLinks, createTaskLink, deleteTaskLink, type TaskLink } from "@/lib/supabase/task-links-repo";
import { fetchEpics, type Epic } from "@/lib/supabase/epics-repo";
import { fetchSprints, type Sprint } from "@/lib/supabase/sprints-repo";
import TaskGithubSection from "./TaskGithubSection";
import TaskTimeSection from "./TaskTimeSection";
import TaskForwardEmailSection from "./TaskForwardEmailSection";
import TaskMeetingSection from "./TaskMeetingSection";
import TaskShareSection from "./TaskShareSection";
import TaskChecklistSection from "./TaskChecklistSection";
import TaskAttachmentsSection from "./TaskAttachmentsSection";
import TaskTagsSection from "./TaskTagsSection";
import TaskActivitySection from "./TaskActivitySection";
import TaskCommentsSection from "./TaskCommentsSection";

function memberLabel(member: OrgMember): string {
  return member.fullName || member.email || member.userId;
}

interface TaskModalProps {
  mode: "create" | "edit";
  initial?: Task;
  columns: ColumnData[];
  columnId: string;
  onClose: () => void;
  onSave: (task: Omit<Task, "id">, columnId: string, id?: string) => void;
  onDelete?: (id: string) => void;
  onOpenTask?: (task: Task) => void;
}

export default function TaskModal({
  mode,
  initial,
  columns,
  columnId,
  onClose,
  onSave,
  onDelete,
  onOpenTask,
}: TaskModalProps) {
  const { can, supabase, userId, tenantId, members, state, addTask, activeBoardId } = useBoard();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "medium");
  const [assignee, setAssignee] = useState(initial?.assignee ?? "");
  const [tag, setTag] = useState(initial?.tag ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [epicId, setEpicId] = useState(initial?.epicId ?? "");
  const [sprintId, setSprintId] = useState(initial?.sprintId ?? "");
  const [epics, setEpics] = useState<Epic[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState(columnId);
  const modalRef = useRef<HTMLFormElement>(null);
  useDialogA11y(modalRef, onClose);

  const taskId = mode === "edit" ? initial?.id : undefined;

  // `members` se carga de forma asíncrona en BoardContext y puede seguir
  // vacío cuando este modal se monta (loading=false no espera a members).
  // Si guardáramos el default en el useState inicial, quedaría fijo en ""
  // para siempre si el usuario abre "+ Nueva tarea" antes de que members
  // termine de cargar. Se calcula como valor derivado en cada render en vez
  // de con un efecto, así reacciona sin necesitar un setState adicional.
  const effectiveAssignee =
    assignee || (mode === "create" && members[0] ? memberLabel(members[0]) : "");

  const [aiText, setAiText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const [taskLinks, setTaskLinks] = useState<TaskLink[]>([]);
  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkDirection, setLinkDirection] = useState<"blocked_by" | "blocks">("blocked_by");
  const [linkingBusy, setLinkingBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Épicas/sprints son catálogos por tablero, no por tarea — se cargan
  // aunque el modal esté en modo "create" (sin taskId todavía), a
  // diferencia de las etiquetas/checklists/etc. de abajo.
  useEffect(() => {
    if (!activeBoardId) return;
    let cancelled = false;
    Promise.all([fetchEpics(supabase, activeBoardId), fetchSprints(supabase, activeBoardId)])
      .then(([epicsData, sprintsData]) => {
        if (!cancelled) {
          setEpics(epicsData);
          setSprints(sprintsData);
        }
      })
      .catch((err) => {
        console.error("No se pudieron cargar épicas/sprints:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, activeBoardId]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    fetchTaskLinks(supabase, taskId)
      .then((links) => {
        if (!cancelled) setTaskLinks(links);
      })
      .catch((err) => {
        console.error("No se pudieron cargar las dependencias:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, taskId, tenantId, activeBoardId]);

  // Reunión, Compartir, GitHub y Tiempo son secciones minoritarias — la
  // mayoría de usuarios nunca las abre en una sesión dada. Cada una carga
  // sus propios datos con un pequeño delay para no competir con el fetch
  // "core" de arriba (links) por ancho de banda justo cuando el modal
  // recién se vuelve interactivo (AUDITORIA_2026-09-03.md, hallazgo 10).
  // Adjuntos, Checklist, Etiquetas, Actividad y Comentarios también cargan
  // los suyos por su cuenta, pero de inmediato (siguen siendo "core") —
  // ver TaskGithubSection.tsx/TaskTimeSection.tsx/TaskMeetingSection.tsx/
  // TaskShareSection.tsx/TaskChecklistSection.tsx/
  // TaskAttachmentsSection.tsx/TaskTagsSection.tsx/TaskActivitySection.tsx/
  // TaskCommentsSection.tsx (Tarea 9 del plan de 2026-09-04).

  async function handleAiParse() {
    if (!aiText.trim() || !tenantId || aiParsing) return;
    setAiParsing(true);
    setAiError(null);
    try {
      const res = await fetch("/api/tasks/parse-natural-language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText.trim(), tenantId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo interpretar el texto.");
      }
      setTitle(json.title);
      setPriority(json.priority);
      if (json.dueDate) setDueDate(json.dueDate);
      setAiText("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "No se pudo interpretar el texto.");
    } finally {
      setAiParsing(false);
    }
  }

  // Subtasks: created as normal tasks with parentTaskId set, in the same
  // column as their parent. Reuses the same addTask() the "+ Nueva tarea"
  // flow already uses (fractional positioning, optimistic update) —
  // subtasks are not a separate data model, just tasks with a parent link.
  const subtasks = taskId ? Object.values(state.tasks).filter((t) => t.parentTaskId === taskId) : [];
  const parentTask = initial?.parentTaskId ? state.tasks[initial.parentTaskId] : undefined;

  function handleAddSubtask() {
    const title = newSubtaskTitle.trim();
    if (!title || !taskId) return;
    addTask(selectedColumnId, {
      id: generateTempId(),
      title,
      priority: "medium",
      assignee: "Sin asignar",
      parentTaskId: taskId,
    });
    setNewSubtaskTitle("");
  }

  // Dependencies (task_links, link_type "blocks"): "blockedBy" are tasks
  // that must finish before this one can start; "blocking" are tasks this
  // one is holding up. Only surfacing "blocks" in the UI for now — the DB
  // also allows "related_to"/"duplicates" but those add UI complexity with
  // no clear v1 payoff (YAGNI).
  const blockedBy = taskId
    ? taskLinks.filter((l) => l.linkType === "blocks" && l.targetTaskId === taskId).map((l) => ({ link: l, task: state.tasks[l.sourceTaskId] }))
    : [];
  const blocking = taskId
    ? taskLinks.filter((l) => l.linkType === "blocks" && l.sourceTaskId === taskId).map((l) => ({ link: l, task: state.tasks[l.targetTaskId] }))
    : [];
  const blockedByUnresolved = blockedBy.filter(({ task: t }) => {
    if (!t) return false;
    const col = columns.find((c) => c.taskIds.includes(t.id));
    return !(col?.isDoneState ?? false);
  });

  async function handleAddLink() {
    if (!taskId || !linkTargetId || linkingBusy) return;
    setLinkingBusy(true);
    setLinkError(null);
    try {
      const [sourceId, targetId] = linkDirection === "blocked_by" ? [linkTargetId, taskId] : [taskId, linkTargetId];
      const created = await createTaskLink(supabase, sourceId, targetId, "blocks");
      setTaskLinks((prev) => [...prev, created]);
      setLinkTargetId("");
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "No se pudo crear la dependencia.");
    } finally {
      setLinkingBusy(false);
    }
  }

  async function handleRemoveLink(linkId: string) {
    try {
      await deleteTaskLink(supabase, linkId);
      setTaskLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "No se pudo eliminar la dependencia.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const assigneeUserId = members.find((m) => memberLabel(m) === effectiveAssignee)?.userId ?? null;
    onSave(
      {
        title: title.trim(),
        priority,
        assignee: effectiveAssignee,
        assigneeUserId,
        tag: tag.trim() || undefined,
        dueDate: dueDate || undefined,
        commentCount: initial?.commentCount,
        attachmentCount: initial?.attachmentCount,
        epicId: epicId || null,
        sprintId: sprintId || null,
      },
      selectedColumnId,
      initial?.id
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        style={{ width: "100%", maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
      >
        <div className="modal-head">
          <h2 id="task-modal-title">{mode === "create" ? "Nueva tarea" : "Editar tarea"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {mode === "create" && (
            <div className="field">
              <label htmlFor="ai-quick-add">✨ Crear con IA (opcional)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="ai-quick-add"
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  placeholder='ej. "Enviar propuesta al cliente el viernes, es urgente"'
                  disabled={aiParsing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAiParse();
                    }
                  }}
                />
                <button type="button" className="btn" onClick={handleAiParse} disabled={aiParsing || !aiText.trim()}>
                  {aiParsing ? "…" : "Interpretar"}
                </button>
              </div>
              {aiError && (
                <p role="alert" className="field-error">
                  {aiError}
                </p>
              )}
            </div>
          )}
          <div className="field">
            <label htmlFor="title">Título</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Login SSO con Google Workspace"
              maxLength={300}
              autoFocus
              required
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="status">Estado</label>
              <select
                id="status"
                value={selectedColumnId}
                onChange={(e) => setSelectedColumnId(e.target.value)}
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="priority">Prioridad</label>
              <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="urgent">Urgente</option>
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Baja</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="assignee">Asignado</label>
              <select id="assignee" value={effectiveAssignee} onChange={(e) => setAssignee(e.target.value)}>
                {effectiveAssignee && !members.some((m) => memberLabel(m) === effectiveAssignee) ? (
                  <option value={effectiveAssignee}>{`${effectiveAssignee} (no es miembro actual)`}</option>
                ) : null}
                {members.map((m) => {
                  const label = memberLabel(m);
                  return (
                    <option key={m.membershipId} value={label}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="tag">Etiqueta</label>
              <input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="backend" />
            </div>
            <div className="field">
              <label htmlFor="due">Vence</label>
              <div style={{ display: "flex", alignItems: "center" }}>
                <input
                  id="due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {(() => {
                  const badge = dueBadge(dueDate || undefined);
                  return badge ? <span className={`due-badge ${badge.variant}`}>{badge.label}</span> : null;
                })()}
              </div>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="epic">Épica</label>
              <select id="epic" value={epicId} onChange={(e) => setEpicId(e.target.value)}>
                <option value="">Sin épica</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sprint">Sprint</label>
              <select id="sprint" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
                <option value="">Sin sprint</option>
                {sprints.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name} {sp.status === "active" ? "(activo)" : sp.status === "closed" ? "(cerrado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {taskId ? (
            <>
              <TaskTagsSection taskId={taskId} />

              {parentTask && (
                <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  ↳ Subtarea de:{" "}
                  <button
                    type="button"
                    className="comment-reply-btn"
                    style={{ display: "inline", margin: 0 }}
                    onClick={() => onOpenTask?.(parentTask)}
                  >
                    {parentTask.title}
                  </button>
                </p>
              )}

              <div className="field task-section">
                <label>Subtareas</label>
                {subtasks.length === 0 ? (
                  <p>Sin subtareas todavía.</p>
                ) : (
                  <ul className="attachment-list">
                    {subtasks.map((sub) => {
                      const subCol = columns.find((c) => c.taskIds.includes(sub.id));
                      const done = subCol?.isDoneState ?? false;
                      return (
                        <li key={sub.id} className="attachment-item">
                          <button
                            type="button"
                            className="comment-reply-btn"
                            style={{
                              margin: 0,
                              color: done ? "var(--muted)" : "var(--accent)",
                              textDecoration: done ? "line-through" : undefined,
                            }}
                            onClick={() => onOpenTask?.(sub)}
                          >
                            {sub.title}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {taskId && (
                  <div className="comment-input-wrap">
                    <input
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddSubtask();
                        }
                      }}
                      placeholder="Nueva subtarea"
                    />
                    <button type="button" className="btn" onClick={handleAddSubtask} disabled={!newSubtaskTitle.trim()}>
                      Agregar
                    </button>
                  </div>
                )}
              </div>

              <div className="field task-section">
                <label>Dependencias</label>
                {blockedByUnresolved.length > 0 && (
                  <p role="alert" className="field-error" style={{ marginBottom: 10 }}>
                    ⚠️ Bloqueada por {blockedByUnresolved.length} tarea(s) sin terminar
                  </p>
                )}
                {linkError && (
                  <p role="alert" className="field-error">
                    {linkError}
                  </p>
                )}
                {blockedBy.length === 0 && blocking.length === 0 ? (
                  <p>Sin dependencias todavía.</p>
                ) : (
                  <ul className="attachment-list">
                    {blockedBy.map(({ link, task: t }) => (
                      <li key={link.id} className="attachment-item">
                        <span className="attachment-name">
                          Bloqueada por:{" "}
                          {t ? (
                            <button type="button" className="comment-reply-btn" style={{ display: "inline", margin: 0 }} onClick={() => onOpenTask?.(t)}>
                              {t.title}
                            </button>
                          ) : (
                            "(tarea eliminada)"
                          )}
                        </span>
                        <button type="button" className="btn danger" onClick={() => handleRemoveLink(link.id)}>
                          Quitar
                        </button>
                      </li>
                    ))}
                    {blocking.map(({ link, task: t }) => (
                      <li key={link.id} className="attachment-item">
                        <span className="attachment-name">
                          Bloquea a:{" "}
                          {t ? (
                            <button type="button" className="comment-reply-btn" style={{ display: "inline", margin: 0 }} onClick={() => onOpenTask?.(t)}>
                              {t.title}
                            </button>
                          ) : (
                            "(tarea eliminada)"
                          )}
                        </span>
                        <button type="button" className="btn danger" onClick={() => handleRemoveLink(link.id)}>
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {taskId && (
                  <div className="field-row" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label htmlFor="link-direction">Relación</label>
                      <select
                        id="link-direction"
                        value={linkDirection}
                        onChange={(e) => setLinkDirection(e.target.value as "blocked_by" | "blocks")}
                        disabled={linkingBusy}
                      >
                        <option value="blocked_by">Está bloqueada por…</option>
                        <option value="blocks">Bloquea a…</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="link-target">Tarea</label>
                      <select
                        id="link-target"
                        value={linkTargetId}
                        onChange={(e) => setLinkTargetId(e.target.value)}
                        disabled={linkingBusy}
                      >
                        <option value="">Selecciona una tarea…</option>
                        {Object.values(state.tasks)
                          .filter((t) => t.id !== taskId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}
                {taskId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 10 }}
                    onClick={handleAddLink}
                    disabled={!linkTargetId || linkingBusy}
                  >
                    {linkingBusy ? "Agregando…" : "Agregar dependencia"}
                  </button>
                )}
              </div>

              {taskId && <TaskTimeSection taskId={taskId} />}

              {taskId && <TaskChecklistSection taskId={taskId} />}

              {taskId && <TaskAttachmentsSection taskId={taskId} />}

              {taskId && <TaskForwardEmailSection taskId={taskId} />}

              {taskId && <TaskMeetingSection taskId={taskId} />}

              {taskId && <TaskGithubSection taskId={taskId} />}

              {taskId && <TaskShareSection taskId={taskId} />}

              <TaskActivitySection taskId={taskId} columns={columns} />

              <TaskCommentsSection taskId={taskId} />
            </>
          ) : null}
        </div>
        <div className="modal-foot">
          {mode === "edit" && initial && onDelete && can("task.delete") ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => onDelete(initial.id)}
            >
              Eliminar
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary">
              {mode === "create" ? "Crear tarea" : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
