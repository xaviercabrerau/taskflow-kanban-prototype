"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useBoard } from "@/context/BoardContext";
import { Task, assigneeColor, assigneeInitial, formatDue, isOverdue, priorityLabel } from "@/lib/types";
import Column from "./Column";
import TaskModal from "./TaskModal";
import Shell from "./Shell";
import CursorOverlay from "./CursorOverlay";
import { usePresenceCursors } from "@/hooks/usePresenceCursors";
import { generateTempId } from "@/lib/tempId";
import { fetchSavedViews, createSavedView, deleteSavedView, type SavedView } from "@/lib/supabase/saved-views-repo";
import CommandPalette from "./CommandPalette";

export default function Board() {
  const {
    state,
    moveTask,
    addTask,
    addColumn,
    updateTask,
    deleteTask,
    supabase,
    userId,
    activeBoardId,
    members,
    can,
    searchQuery,
    setSearchQuery,
  } = useBoard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [savingView, setSavingView] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [showSaveViewForm, setShowSaveViewForm] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkColumnId, setBulkColumnId] = useState("");
  const [bulkAssigneeLabel, setBulkAssigneeLabel] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [columnError, setColumnError] = useState<string | null>(null);
  const [savingColumn, setSavingColumn] = useState(false);
  const displayName =
    members.find((m) => m.userId === userId)?.fullName ||
    members.find((m) => m.userId === userId)?.email ||
    "Alguien";
  const { cursors, publish, clear } = usePresenceCursors(supabase, activeBoardId, userId, displayName);

  function handleBoardMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    publish(x, y);
  }
  const [modal, setModal] = useState<{ mode: "create" | "edit"; task?: Task; columnId?: string } | null>(
    null
  );

  // Stable callback identities so Column/TaskCard's React.memo can actually
  // skip re-rendering unaffected cards on unrelated Board re-renders (e.g.
  // every keystroke in the search box) — an inline arrow here would give
  // every card a "new" onOpen prop each render and defeat the memo.
  const handleOpenTask = useCallback((task: Task) => {
    const col = state.columns.find((c) => c.taskIds.includes(task.id));
    setModal({ mode: "edit", task, columnId: col?.id });
  }, [state.columns]);

  // Deep link (?task=<id>), used by the "Ver tarea completa" link in
  // forward-by-email and future notification emails — there's no dedicated
  // task route in this app (tasks only ever open as a modal over the
  // board), so this is the mechanism for "open this specific task" links.
  // Runs once state.tasks is populated; strips the param afterwards so a
  // refresh/back-navigation doesn't keep re-opening the same modal.
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId) return;
    const task = state.tasks[taskId];
    if (!task) return;
    handleOpenTask(task);
    router.replace("/");
  }, [searchParams, state.tasks, handleOpenTask, router]);

  const handleAddTask = useCallback((columnId: string) => {
    setModal({ mode: "create", columnId });
  }, []);

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const col of state.columns) {
      map.set(
        col.id,
        col.taskIds
          .map((id) => state.tasks[id])
          .filter(Boolean)
          .filter((task) => assigneeFilter === null || task.assigneeUserId === assigneeFilter)
          .filter((task) => priorityFilter === null || task.priority === priorityFilter)
          .filter((task) => tagFilter === null || task.tag === tagFilter)
          .filter(
            (task) =>
              !searchQuery.trim() ||
              task.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
          )
      );
    }
    return map;
  }, [state.columns, state.tasks, assigneeFilter, priorityFilter, tagFilter, searchQuery]);

  useEffect(() => {
    if (!activeBoardId) return;
    let cancelled = false;
    fetchSavedViews(supabase, activeBoardId)
      .then((views) => {
        if (!cancelled) setSavedViews(views);
      })
      .catch((err) => console.error("No se pudieron cargar las vistas guardadas:", err));
    return () => {
      cancelled = true;
    };
  }, [supabase, activeBoardId]);

  function applyView(viewId: string) {
    setSelectedViewId(viewId);
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    setSearchQuery(view.filters.searchQuery ?? "");
    setAssigneeFilter(view.filters.assigneeUserId ?? null);
    setPriorityFilter(view.filters.priority ?? null);
    setTagFilter(view.filters.tag ?? null);
  }

  async function handleSaveView() {
    if (!activeBoardId || !userId || !newViewName.trim() || savingView) return;
    setSavingView(true);
    try {
      const created = await createSavedView(supabase, activeBoardId, userId, newViewName.trim(), {
        searchQuery: searchQuery || undefined,
        assigneeUserId: assigneeFilter,
        priority: priorityFilter,
        tag: tagFilter,
      });
      setSavedViews((prev) => [...prev, created]);
      setSelectedViewId(created.id);
      setNewViewName("");
      setShowSaveViewForm(false);
    } catch (err) {
      console.error("No se pudo guardar la vista:", err);
    } finally {
      setSavingView(false);
    }
  }

  async function handleDeleteView() {
    if (!selectedViewId) return;
    try {
      await deleteSavedView(supabase, selectedViewId);
      setSavedViews((prev) => prev.filter((v) => v.id !== selectedViewId));
      setSelectedViewId("");
    } catch (err) {
      console.error("No se pudo eliminar la vista:", err);
    }
  }

  const availableTags = Array.from(new Set(Object.values(state.tasks).map((t) => t.tag).filter((t): t is string => Boolean(t)))).sort();

  function toggleSelect(taskId: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedTaskIds(new Set());
    setBulkColumnId("");
    setBulkAssigneeLabel("");
    setBulkTag("");
  }

  async function handleBulkMove() {
    if (!bulkColumnId || selectedTaskIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const destLen = state.columns.find((c) => c.id === bulkColumnId)?.taskIds.length ?? 0;
      let offset = 0;
      for (const taskId of selectedTaskIds) {
        moveTask(taskId, bulkColumnId, destLen + offset);
        offset++;
      }
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  function handleBulkAssign() {
    if (!bulkAssigneeLabel || selectedTaskIds.size === 0 || bulkBusy) return;
    const member = members.find((m) => (m.fullName || m.email || m.userId) === bulkAssigneeLabel);
    for (const taskId of selectedTaskIds) {
      const task = state.tasks[taskId];
      if (!task) continue;
      updateTask({ ...task, assignee: bulkAssigneeLabel, assigneeUserId: member?.userId ?? null });
    }
    clearSelection();
  }

  function handleBulkTag() {
    if (selectedTaskIds.size === 0 || bulkBusy) return;
    for (const taskId of selectedTaskIds) {
      const task = state.tasks[taskId];
      if (!task) continue;
      updateTask({ ...task, tag: bulkTag.trim() || undefined });
    }
    clearSelection();
  }

  function handleBulkDelete() {
    if (selectedTaskIds.size === 0) return;
    if (!window.confirm(`¿Eliminar ${selectedTaskIds.size} tarea(s)? Esta acción no se puede deshacer.`)) return;
    for (const taskId of selectedTaskIds) {
      deleteTask(taskId);
    }
    clearSelection();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // dnd-kit anuncia en inglés y sin mencionar la columna destino por
  // defecto; esta app es en español y el destino es justo lo que un
  // usuario de lector de pantalla necesita saber al mover una tarea.
  const accessibility = useMemo(
    () => {
      function columnTitleFor(overId: string): string | undefined {
        const destCol =
          state.columns.find((c) => c.id === overId) ??
          state.columns.find((c) => c.taskIds.includes(overId));
        return destCol?.title;
      }

      return {
      screenReaderInstructions: {
        draggable:
          "Presiona espacio o enter para levantar la tarea. Usa las flechas del teclado para moverla entre columnas y posiciones. Presiona espacio o enter otra vez para soltarla, o escape para cancelar.",
      },
      announcements: {
        onDragStart: ({ active }: { active: { id: string | number } }) => {
          const task = state.tasks[String(active.id)];
          return task ? `Se levantó la tarea "${task.title}".` : undefined;
        },
        onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) => {
          if (!over) return undefined;
          const task = state.tasks[String(active.id)];
          const colTitle = columnTitleFor(String(over.id));
          if (!task || !colTitle) return undefined;
          return `La tarea "${task.title}" está sobre la columna "${colTitle}".`;
        },
        onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) => {
          const task = state.tasks[String(active.id)];
          if (!task) return undefined;
          if (!over) return `Se canceló el arrastre de la tarea "${task.title}".`;
          const colTitle = columnTitleFor(String(over.id));
          return colTitle
            ? `La tarea "${task.title}" se movió a la columna "${colTitle}".`
            : `Se soltó la tarea "${task.title}".`;
        },
        onDragCancel: ({ active }: { active: { id: string | number } }) => {
          const task = state.tasks[String(active.id)];
          return task ? `Se canceló el arrastre de la tarea "${task.title}".` : undefined;
        },
      },
      };
    },
    [state.tasks, state.columns]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeTaskId = String(active.id);
    const overId = String(over.id);

    const sourceCol = state.columns.find((c) => c.taskIds.includes(activeTaskId));
    if (!sourceCol) return;

    let destCol = state.columns.find((c) => c.id === overId);
    let destIndex: number;

    if (destCol) {
      destIndex = destCol.taskIds.length;
    } else {
      destCol = state.columns.find((c) => c.taskIds.includes(overId));
      if (!destCol) return;
      destIndex = destCol.taskIds.indexOf(overId);
      if (destCol.id === sourceCol.id) {
        const sourceIndex = sourceCol.taskIds.indexOf(activeTaskId);
        if (sourceIndex < destIndex) destIndex -= 1;
      }
    }

    if (destCol.id === sourceCol.id && destCol.taskIds.indexOf(activeTaskId) === destIndex) return;
    moveTask(activeTaskId, destCol.id, destIndex);
  }

  const activeTask = activeId ? state.tasks[activeId] : null;

  return (
    <Shell onNewTask={() => setModal({ mode: "create", columnId: state.columns[0]?.id })}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={accessibility}
      >
        <div className="assignee-filter">
          <label>
            Filtrar por persona
            <select
              aria-label="Filtrar por persona"
              value={assigneeFilter ?? ""}
              onChange={(e) => {
                setAssigneeFilter(e.target.value === "" ? null : e.target.value);
                setSelectedViewId("");
              }}
            >
              <option value="">Todos</option>
              {members.map((member) => {
                const label = member.fullName || member.email || member.userId;
                return (
                  <option key={member.membershipId} value={member.userId}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Prioridad
            <select
              aria-label="Filtrar por prioridad"
              value={priorityFilter ?? ""}
              onChange={(e) => {
                setPriorityFilter(e.target.value || null);
                setSelectedViewId("");
              }}
            >
              <option value="">Todas</option>
              <option value="urgent">Urgente</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </select>
          </label>
          {availableTags.length > 0 && (
            <label>
              Etiqueta
              <select
                aria-label="Filtrar por etiqueta"
                value={tagFilter ?? ""}
                onChange={(e) => {
                  setTagFilter(e.target.value || null);
                  setSelectedViewId("");
                }}
              >
                <option value="">Todas</option>
                {availableTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Vista guardada
            <select aria-label="Vista guardada" value={selectedViewId} onChange={(e) => applyView(e.target.value)}>
              <option value="">Vista personalizada</option>
              {savedViews.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          {selectedViewId && (
            <button type="button" className="icon-btn" title="Eliminar vista" onClick={handleDeleteView}>
              🗑️
            </button>
          )}
          {!showSaveViewForm ? (
            <button type="button" className="btn" onClick={() => setShowSaveViewForm(true)}>
              💾 Guardar vista
            </button>
          ) : (
            <>
              <input
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="Nombre de la vista"
                style={{ width: 160 }}
              />
              <button type="button" className="btn primary" onClick={handleSaveView} disabled={!newViewName.trim() || savingView}>
                {savingView ? "Guardando…" : "Guardar"}
              </button>
              <button type="button" className="btn" onClick={() => setShowSaveViewForm(false)}>
                Cancelar
              </button>
            </>
          )}
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>⌘/Ctrl + clic para seleccionar varias tareas</span>
        </div>

        {selectedTaskIds.size > 0 && (
          <div className="assignee-filter" role="toolbar" aria-label="Acciones en lote">
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>{selectedTaskIds.size} seleccionada(s)</span>
            <label>
              Mover a
              <select value={bulkColumnId} onChange={(e) => setBulkColumnId(e.target.value)}>
                <option value="">Elegir columna…</option>
                {state.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={handleBulkMove} disabled={!bulkColumnId || bulkBusy}>
              Mover
            </button>
            <label>
              Asignar a
              <select value={bulkAssigneeLabel} onChange={(e) => setBulkAssigneeLabel(e.target.value)}>
                <option value="">Elegir persona…</option>
                {members.map((m) => {
                  const label = m.fullName || m.email || m.userId;
                  return (
                    <option key={m.membershipId} value={label}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>
            <button type="button" className="btn" onClick={handleBulkAssign} disabled={!bulkAssigneeLabel || bulkBusy}>
              Asignar
            </button>
            <input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="Etiqueta" style={{ width: 110 }} />
            <button type="button" className="btn" onClick={handleBulkTag} disabled={bulkBusy}>
              Etiquetar
            </button>
            <button type="button" className="btn danger" onClick={handleBulkDelete}>
              Eliminar
            </button>
            <button type="button" className="btn" onClick={clearSelection}>
              Cancelar
            </button>
          </div>
        )}

        <div className="board" onMouseMove={handleBoardMouseMove} onMouseLeave={clear}>
          {state.columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasksByColumn.get(col.id) ?? []}
              onOpenTask={handleOpenTask}
              onAddTask={handleAddTask}
              selectedTaskIds={selectedTaskIds}
              onToggleSelect={toggleSelect}
            />
          ))}
          {can("board.manage") && (
            <div className="col add-column-card">
              {addingColumn ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newColumnName.trim() || savingColumn) return;
                    setSavingColumn(true);
                    const result = await addColumn(newColumnName);
                    setSavingColumn(false);
                    if (result.ok) {
                      setNewColumnName("");
                      setAddingColumn(false);
                      setColumnError(null);
                    } else {
                      setColumnError(result.message);
                    }
                  }}
                >
                  <input
                    autoFocus
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    placeholder="Nombre de la columna"
                    aria-label="Nombre de la columna"
                  />
                  {columnError && <p className="add-column-error">{columnError}</p>}
                  <div className="add-column-actions">
                    <button type="submit" className="btn primary" disabled={savingColumn}>
                      {savingColumn ? "Creando…" : "Añadir"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setAddingColumn(false);
                        setColumnError(null);
                        setNewColumnName("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className="add-task" onClick={() => setAddingColumn(true)}>
                  ＋ Añadir columna
                </button>
              )}
            </div>
          )}
          <CursorOverlay cursors={cursors} />
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className={`card p-${activeTask.priority}`} style={{ width: 276 }}>
              <p className="card-title">{activeTask.title}</p>
              <div className="chip-row">
                <span className={`chip pr-${activeTask.priority}`}>{priorityLabel(activeTask.priority)}</span>
                {activeTask.tag && <span className="chip tag">{activeTask.tag}</span>}
              </div>
              <div className="card-meta">
                <div className="meta-av" style={{ background: assigneeColor(activeTask.assignee) }}>
                  {assigneeInitial(activeTask.assignee)}
                </div>
                <div className="meta-spacer" />
                <span className={`due mono${isOverdue(activeTask.dueDate) ? " overdue" : ""}`}>
                  {formatDue(activeTask.dueDate)}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {modal && state.columns.length > 0 && (
        <TaskModal
          // Forces a clean remount (fresh internal form state) when a
          // subtask link inside the modal switches it to a different task
          // — without this, React reuses the same mounted instance and its
          // useState(initial?.title ...) values would stay stale.
          key={modal.task?.id ?? `new-${modal.columnId}`}
          mode={modal.mode}
          initial={modal.task}
          columns={state.columns}
          columnId={modal.columnId ?? state.columns[0].id}
          onOpenTask={handleOpenTask}
          onClose={() => setModal(null)}
          onSave={(taskData, columnId, id) => {
            if (id) {
              updateTask({ ...taskData, id });
              const currentCol = state.columns.find((c) => c.taskIds.includes(id));
              if (currentCol && currentCol.id !== columnId) {
                const destLen = state.columns.find((c) => c.id === columnId)?.taskIds.length ?? 0;
                moveTask(id, columnId, destLen);
              }
            } else {
              const newId = generateTempId();
              addTask(columnId, { ...taskData, id: newId });
            }
            setModal(null);
          }}
          onDelete={(id) => {
            deleteTask(id);
            setModal(null);
          }}
        />
      )}
      <CommandPalette
        onOpenTask={handleOpenTask}
        onCreateTask={() => setModal({ mode: "create", columnId: state.columns[0]?.id })}
      />
    </Shell>
  );
}
