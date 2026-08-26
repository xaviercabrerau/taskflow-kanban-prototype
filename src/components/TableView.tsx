"use client";

import { Fragment, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { Task, assigneeColor, assigneeInitial, formatDue, isOverdue, priorityLabel } from "@/lib/types";
import Shell from "./Shell";
import TaskModal from "./TaskModal";
import { generateTempId } from "@/lib/tempId";
import { useClickableRow } from "@/hooks/useClickableRow";

function TaskTableRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const overdue = isOverdue(task.dueDate);
  const rowProps = useClickableRow(onOpen);
  return (
    <tr className="task-row">
      <td>
        <span className="task-row-trigger" {...rowProps}>
          {task.title}
        </span>
      </td>
      <td>
        <div className="who">
          <div className="av" style={{ background: assigneeColor(task.assignee) }}>
            {assigneeInitial(task.assignee)}
          </div>
          {task.assignee}
        </div>
      </td>
      <td>
        <span className={`chip pr-${task.priority}`}>{priorityLabel(task.priority)}</span>
      </td>
      <td className={`mono due-cell${overdue ? " overdue" : ""}`}>{formatDue(task.dueDate)}</td>
    </tr>
  );
}

export default function TableView() {
  const { state, addTask, updateTask, deleteTask, moveTask } = useBoard();
  const [modal, setModal] = useState<{ mode: "create" | "edit"; task?: Task; columnId?: string } | null>(
    null
  );

  return (
    <Shell onNewTask={() => setModal({ mode: "create", columnId: state.columns[0]?.id })}>
      <div className="page-wrap">
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Asignado</th>
                <th>Prioridad</th>
                <th>Vence</th>
              </tr>
            </thead>
            <tbody>
              {state.columns.map((col) => {
                const tasks = col.taskIds.map((id) => state.tasks[id]).filter(Boolean);
                return (
                  <Fragment key={col.id}>
                    <tr className="group-row">
                      <td colSpan={4}>
                        <span className="group-dot" style={{ background: `var(${col.colorVar})` }} />
                        {col.title} — {tasks.length}
                      </td>
                    </tr>
                    {tasks.map((task) => (
                      <TaskTableRow
                        key={task.id}
                        task={task}
                        onOpen={() => setModal({ mode: "edit", task, columnId: col.id })}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
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
