"use client";

import { useCallback, useMemo, useState } from "react";
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
  } = useBoard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
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
          .filter(
            (task) =>
              !searchQuery.trim() ||
              task.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
          )
      );
    }
    return map;
  }, [state.columns, state.tasks, assigneeFilter, searchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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
      >
        <div className="assignee-filter">
          <label>
            Filtrar por persona
            <select
              aria-label="Filtrar por persona"
              value={assigneeFilter ?? ""}
              onChange={(e) => setAssigneeFilter(e.target.value === "" ? null : e.target.value)}
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
        </div>

        <div className="board" onMouseMove={handleBoardMouseMove} onMouseLeave={clear}>
          {state.columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasksByColumn.get(col.id) ?? []}
              onOpenTask={handleOpenTask}
              onAddTask={handleAddTask}
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
          mode={modal.mode}
          initial={modal.task}
          columns={state.columns}
          columnId={modal.columnId ?? state.columns[0].id}
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
    </Shell>
  );
}
