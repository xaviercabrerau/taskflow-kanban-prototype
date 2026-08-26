"use client";

import { useMemo, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { Task } from "@/lib/types";
import { generateTempId } from "@/lib/tempId";
import Shell from "./Shell";
import TaskModal from "./TaskModal";
import { useClickableRow } from "@/hooks/useClickableRow";

function CalendarTaskChip({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const rowProps = useClickableRow(onOpen);
  return (
    <div className={`calendar-task-chip pr-${task.priority}`} {...rowProps}>
      {task.title}
    </div>
  );
}

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_CHIPS_PER_DAY = 3;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export default function CalendarView() {
  const { state, addTask, updateTask, deleteTask, moveTask } = useBoard();
  const [modal, setModal] = useState<{ mode: "create" | "edit"; task?: Task; columnId?: string } | null>(
    null
  );
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return startOfDay(d);
  });

  const today = startOfDay(new Date());

  const monthLabel = visibleMonth
    .toLocaleDateString("es-EC", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());

  const tasksByDueDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of Object.values(state.tasks)) {
      if (!task.dueDate) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    return map;
  }, [state.tasks]);

  const columnIdForTask = (taskId: string): string | undefined =>
    state.columns.find((c) => c.taskIds.includes(taskId))?.id;

  const days = useMemo(() => {
    const firstOfMonth = new Date(visibleMonth);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - mondayIndex(firstOfMonth));

    const lastOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
    const gridEnd = new Date(lastOfMonth);
    gridEnd.setDate(gridEnd.getDate() + (6 - mondayIndex(lastOfMonth)));

    const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1;

    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [visibleMonth]);

  function goToPreviousMonth() {
    setVisibleMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  }

  function goToNextMonth() {
    setVisibleMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  }

  function goToToday() {
    const d = new Date();
    d.setDate(1);
    setVisibleMonth(startOfDay(d));
  }

  return (
    <Shell onNewTask={() => setModal({ mode: "create", columnId: state.columns[0]?.id })}>
      <div className="page-wrap">
        <div className="panel calendar">
          <div className="calendar-toolbar">
            <button className="btn" onClick={goToPreviousMonth} type="button">
              ‹ Mes anterior
            </button>
            <div className="calendar-title">{monthLabel}</div>
            <button className="btn" onClick={goToNextMonth} type="button">
              Mes siguiente ›
            </button>
            <button className="btn" onClick={goToToday} type="button">
              Hoy
            </button>
          </div>
          <div className="calendar-weekdays">
            {WEEKDAY_LABELS.map((label) => (
              <div className="calendar-weekday" key={label}>
                {label}
              </div>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const key = toKey(day);
              const tasks = tasksByDueDate.get(key) ?? [];
              const isOutside = day.getMonth() !== visibleMonth.getMonth();
              const isToday = day.getTime() === today.getTime();
              const shown = tasks.slice(0, MAX_CHIPS_PER_DAY);
              const extraCount = tasks.length - shown.length;

              return (
                <div
                  className={`calendar-day${isOutside ? " calendar-day-outside" : ""}${
                    isToday ? " calendar-day-today" : ""
                  }`}
                  key={key}
                >
                  <div className="calendar-day-number">{day.getDate()}</div>
                  <div className="calendar-day-tasks">
                    {shown.map((task) => (
                      <CalendarTaskChip
                        key={task.id}
                        task={task}
                        onOpen={() =>
                          setModal({ mode: "edit", task, columnId: columnIdForTask(task.id) })
                        }
                      />
                    ))}
                    {extraCount > 0 && <div className="calendar-task-more">+{extraCount} más</div>}
                  </div>
                </div>
              );
            })}
          </div>
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
