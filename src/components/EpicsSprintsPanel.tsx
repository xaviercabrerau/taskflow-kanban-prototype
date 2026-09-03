"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { fetchEpics, createEpic, updateEpicStatus, deleteEpic, type Epic } from "@/lib/supabase/epics-repo";
import {
  fetchSprints,
  createSprint,
  updateSprintStatus,
  deleteSprint,
  type Sprint,
  type SprintStatus,
} from "@/lib/supabase/sprints-repo";

interface EpicsSprintsPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  planned: "Planificado",
  active: "Activo",
  closed: "Cerrado",
};

export default function EpicsSprintsPanel({ onClose, embedded = false }: EpicsSprintsPanelProps) {
  const { supabase, activeBoardId, state, isOwner } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [epics, setEpics] = useState<Epic[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [epicName, setEpicName] = useState("");
  const [creatingEpic, setCreatingEpic] = useState(false);

  const [sprintName, setSprintName] = useState("");
  const [sprintStart, setSprintStart] = useState("");
  const [sprintEnd, setSprintEnd] = useState("");
  const [creatingSprint, setCreatingSprint] = useState(false);

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
        if (!cancelled) setError("No se pudieron cargar épicas/sprints.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, activeBoardId]);

  // Progreso calculado en el cliente a partir de state.tasks (ya cargado
  // completo por el tablero) — evita una consulta adicional por
  // épica/sprint. "Terminada" = está en una columna con is_done_state.
  function taskProgress(filterFn: (taskId: string) => boolean): { done: number; total: number } {
    const doneColumnIds = new Set(state.columns.filter((c) => c.isDoneState).map((c) => c.id));
    let done = 0;
    let total = 0;
    for (const col of state.columns) {
      for (const taskId of col.taskIds) {
        if (!filterFn(taskId)) continue;
        total++;
        if (doneColumnIds.has(col.id)) done++;
      }
    }
    return { done, total };
  }

  async function handleCreateEpic(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBoardId || !epicName.trim() || creatingEpic) return;
    setCreatingEpic(true);
    setError(null);
    try {
      const created = await createEpic(supabase, activeBoardId, epicName.trim(), null);
      setEpics((prev) => [...prev, created]);
      setEpicName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la épica.");
    } finally {
      setCreatingEpic(false);
    }
  }

  async function handleCloseEpic(epicId: string) {
    try {
      await updateEpicStatus(supabase, epicId, "closed");
      setEpics((prev) => prev.map((e) => (e.id === epicId ? { ...e, status: "closed" } : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la épica.");
    }
  }

  async function handleDeleteEpic(epicId: string) {
    try {
      await deleteEpic(supabase, epicId);
      setEpics((prev) => prev.filter((e) => e.id !== epicId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la épica.");
    }
  }

  async function handleCreateSprint(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBoardId || !sprintName.trim() || creatingSprint) return;
    setCreatingSprint(true);
    setError(null);
    try {
      const created = await createSprint(supabase, activeBoardId, {
        name: sprintName.trim(),
        startDate: sprintStart || null,
        endDate: sprintEnd || null,
      });
      setSprints((prev) => [created, ...prev]);
      setSprintName("");
      setSprintStart("");
      setSprintEnd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el sprint.");
    } finally {
      setCreatingSprint(false);
    }
  }

  async function handleSprintStatus(sprintId: string, status: SprintStatus) {
    try {
      await updateSprintStatus(supabase, sprintId, status);
      setSprints((prev) => prev.map((s) => (s.id === sprintId ? { ...s, status } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el sprint.");
    }
  }

  async function handleDeleteSprint(sprintId: string) {
    try {
      await deleteSprint(supabase, sprintId);
      setSprints((prev) => prev.filter((s) => s.id !== sprintId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el sprint.");
    }
  }

  const panel = (
    <div
      className={embedded ? "admin-panel" : "modal"}
      style={embedded ? undefined : { width: 560 }}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
      ref={modalRef}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby="epics-sprints-title"
    >
      <div className="modal-head">
        <h2 id="epics-sprints-title">Épicas y Sprints</h2>
        {!embedded && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        )}
      </div>
      <div className="modal-body">
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {loading ? (
          <p>Cargando…</p>
        ) : (
          <>
            <div className="field task-section" style={{ paddingTop: 0, borderTop: "none" }}>
              <label>Épicas</label>
              {epics.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Sin épicas todavía.</p>
              ) : (
                epics.map((ep) => {
                  const { done, total } = taskProgress((taskId) => state.tasks[taskId]?.epicId === ep.id);
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <div
                      key={ep.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        marginBottom: 8,
                        opacity: ep.status === "closed" ? 0.55 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{ep.name}</span>
                        {isOwner && (
                          <div style={{ display: "flex", gap: 8 }}>
                            {ep.status !== "closed" && (
                              <button type="button" className="icon-btn" title="Cerrar épica" onClick={() => handleCloseEpic(ep.id)}>
                                ✅
                              </button>
                            )}
                            <button type="button" className="icon-btn" title="Eliminar" onClick={() => handleDeleteEpic(ep.id)}>
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="checklist-progress-row" style={{ marginTop: 6 }}>
                        <span className="checklist-pct">{pct}%</span>
                        <div className="checklist-progress-track">
                          <div className="checklist-progress-fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        {done}/{total} tareas terminadas
                      </div>
                    </div>
                  );
                })
              )}
              {isOwner && (
                <form onSubmit={handleCreateEpic} className="comment-input-wrap" style={{ marginTop: 10 }}>
                  <input value={epicName} onChange={(e) => setEpicName(e.target.value)} placeholder="Nueva épica" />
                  <button type="submit" className="btn" disabled={!epicName.trim() || creatingEpic}>
                    {creatingEpic ? "Creando…" : "Crear"}
                  </button>
                </form>
              )}
            </div>

            <div className="field task-section">
              <label>Sprints</label>
              {sprints.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Sin sprints todavía.</p>
              ) : (
                sprints.map((sp) => {
                  const { done, total } = taskProgress((taskId) => state.tasks[taskId]?.sprintId === sp.id);
                  return (
                    <div
                      key={sp.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        marginBottom: 8,
                        opacity: sp.status === "closed" ? 0.55 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                          {sp.name} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>({SPRINT_STATUS_LABEL[sp.status]})</span>
                        </span>
                        {isOwner && (
                          <div style={{ display: "flex", gap: 8 }}>
                            {sp.status === "planned" && (
                              <button type="button" className="icon-btn" title="Activar" onClick={() => handleSprintStatus(sp.id, "active")}>
                                ▶️
                              </button>
                            )}
                            {sp.status === "active" && (
                              <button type="button" className="icon-btn" title="Cerrar sprint" onClick={() => handleSprintStatus(sp.id, "closed")}>
                                ✅
                              </button>
                            )}
                            <button type="button" className="icon-btn" title="Eliminar" onClick={() => handleDeleteSprint(sp.id)}>
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                      {(sp.startDate || sp.endDate) && (
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {sp.startDate ?? "?"} → {sp.endDate ?? "?"}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        {sp.status === "closed" ? "Velocity: " : ""}
                        {done}/{total} tareas terminadas
                      </div>
                    </div>
                  );
                })
              )}
              {isOwner && (
                <form onSubmit={handleCreateSprint} style={{ marginTop: 10 }}>
                  <div className="field">
                    <input value={sprintName} onChange={(e) => setSprintName(e.target.value)} placeholder="Nombre del sprint" required />
                  </div>
                  <div className="field-row" style={{ marginTop: 8 }}>
                    <div className="field">
                      <label htmlFor="sprint-start">Inicio</label>
                      <input id="sprint-start" type="date" value={sprintStart} onChange={(e) => setSprintStart(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="sprint-end">Fin</label>
                      <input id="sprint-end" type="date" value={sprintEnd} onChange={(e) => setSprintEnd(e.target.value)} />
                    </div>
                  </div>
                  <button type="submit" className="btn" style={{ marginTop: 8 }} disabled={!sprintName.trim() || creatingSprint}>
                    {creatingSprint ? "Creando…" : "Crear sprint"}
                  </button>
                </form>
              )}
            </div>
          </>
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
