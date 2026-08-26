"use client";

import { useMemo, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { Task, parseDateOnly } from "@/lib/types";
import { generateTempId } from "@/lib/tempId";
import Shell from "./Shell";
import TaskModal from "./TaskModal";
import { useClickableRow } from "@/hooks/useClickableRow";

function GanttRow({
  task,
  startCol,
  endCol,
  barClassName,
  windowDays,
  onOpen,
}: {
  task: Task;
  startCol: number;
  endCol: number;
  barClassName: string;
  windowDays: number;
  onOpen: () => void;
}) {
  const rowProps = useClickableRow(onOpen);
  return (
    <div className="gantt-row" style={{ gridTemplateColumns: `170px repeat(${windowDays}, 1fr)` }}>
      <div className="rowlabel">{task.title}</div>
      <div style={{ gridColumn: `${startCol} / ${endCol}` }}>
        <div className={barClassName} {...rowProps}>
          <span className="bar-label">{task.title}</span>
        </div>
      </div>
    </div>
  );
}

const WINDOW_DAYS = 14;
const WINDOW_START_OFFSET = -3; // window starts 3 days before today

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayIndexFrom(windowStart: Date, date: Date): number {
  const ms = startOfDay(date).getTime() - windowStart.getTime();
  return Math.round(ms / 86400000);
}

function formatShort(d: Date): string {
  return d.toLocaleDateString("es-EC", { day: "numeric", month: "short" }).replace(".", "");
}

export default function GanttView() {
  const { state, addTask, updateTask, deleteTask, moveTask } = useBoard();
  const [modal, setModal] = useState<{ mode: "create" | "edit"; task?: Task; columnId?: string } | null>(
    null
  );

  const windowStart = useMemo(() => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + WINDOW_START_OFFSET);
    return d;
  }, []);

  const days = useMemo(
    () =>
      Array.from({ length: WINDOW_DAYS }, (_, i) => {
        const d = new Date(windowStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [windowStart]
  );

  const todayIndex = dayIndexFrom(windowStart, new Date());

  const rows = useMemo(() => {
    const items: { task: Task; columnId: string; startCol: number; endCol: number }[] = [];
    let outsideWindow = 0;
    for (const col of state.columns) {
      for (const taskId of col.taskIds) {
        const task = state.tasks[taskId];
        if (!task || !task.dueDate) continue;
        const due = parseDateOnly(task.dueDate);
        const start = task.startDate ? parseDateOnly(task.startDate) : due;
        let startDay = dayIndexFrom(windowStart, start);
        let endDay = dayIndexFrom(windowStart, due) + 1; // exclusive end for grid-column
        if (endDay <= 0 || startDay >= WINDOW_DAYS) {
          outsideWindow += 1;
          continue;
        }
        startDay = Math.max(0, startDay);
        endDay = Math.min(WINDOW_DAYS, endDay);
        if (endDay <= startDay) endDay = startDay + 1;
        items.push({ task, columnId: col.id, startCol: startDay + 2, endCol: endDay + 2 });
      }
    }
    return { items, outsideWindow };
  }, [state, windowStart]);

  function barClass(task: Task, columnId: string): string {
    const column = state.columns.find((c) => c.id === columnId);
    const isDone = column?.isDoneState ?? false;
    const isFirst = state.columns[0]?.id === columnId;
    const due = task.dueDate ? parseDateOnly(task.dueDate) : null;
    if (due && startOfDay(due).getTime() < startOfDay(new Date()).getTime() && !isDone) {
      return "bar overdue";
    }
    if (!isFirst && !isDone) return "bar active";
    return "bar plain";
  }

  return (
    <Shell onNewTask={() => setModal({ mode: "create", columnId: state.columns[0]?.id })}>
      <div className="page-wrap">
        <div className="panel gantt">
          <div className="gantt-head" style={{ gridTemplateColumns: `170px repeat(${WINDOW_DAYS}, 1fr)` }}>
            <div className="cell lbl"></div>
            {days.map((d, i) => (
              <div className="cell" key={i}>
                {formatShort(d)}
              </div>
            ))}
          </div>
          <div className="gantt-body">
            {todayIndex >= 0 && todayIndex < WINDOW_DAYS && (
              <>
                <div
                  className="today-tag"
                  style={{ left: `calc(170px + (100% - 170px) * ${(todayIndex + 0.5) / WINDOW_DAYS})` }}
                >
                  HOY
                </div>
                <div
                  className="today-line"
                  style={{ left: `calc(170px + (100% - 170px) * ${(todayIndex + 0.5) / WINDOW_DAYS})` }}
                />
              </>
            )}
            {rows.items.map(({ task, columnId, startCol, endCol }) => (
              <GanttRow
                key={task.id}
                task={task}
                startCol={startCol}
                endCol={endCol}
                windowDays={WINDOW_DAYS}
                barClassName={barClass(task, columnId)}
                onOpen={() => setModal({ mode: "edit", task, columnId })}
              />
            ))}
            {rows.items.length === 0 && (
              <p style={{ padding: "24px 18px", color: "var(--muted)", fontSize: 13.5 }}>
                Ninguna tarea con fecha de vencimiento cae en esta ventana de 14 días.
              </p>
            )}
          </div>
          {rows.outsideWindow > 0 && (
            <div className="gantt-note">
              ⓘ {rows.outsideWindow} tarea(s) con fecha fuera de esta ventana no se muestran.
            </div>
          )}
        </div>
      </div>

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
