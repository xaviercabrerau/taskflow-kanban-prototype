"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, assigneeColor, assigneeInitial, formatDue, isOverdue } from "@/lib/types";

interface TaskCardProps {
  task: Task;
  columnId: string;
  onOpen: (task: Task) => void;
}

export default function TaskCard({ task, columnId, onOpen }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { columnId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const overdue = isOverdue(task.dueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`card p-${task.priority}${isDragging ? " dragging" : ""}`}
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" || e.key === " ") {
          if (e.key === " ") e.preventDefault();
          onOpen(task);
        }
      }}
    >
      <p className="card-title">{task.title}</p>
      <div className="chip-row">
        <span className={`chip pr-${task.priority}`}>
          {task.priority === "urgent"
            ? "Urgente"
            : task.priority === "high"
              ? "Alta"
              : task.priority === "medium"
                ? "Media"
                : "Baja"}
        </span>
        {task.tag && <span className="chip tag">{task.tag}</span>}
      </div>
      <div className="card-meta">
        <div className="meta-av" style={{ background: assigneeColor(task.assignee) }} title={task.assignee}>
          {assigneeInitial(task.assignee)}
        </div>
        {task.attachmentCount ? <div className="meta-ic">📎 {task.attachmentCount}</div> : null}
        {task.commentCount ? <div className="meta-ic">💬 {task.commentCount}</div> : null}
        <div className="meta-spacer" />
        <span className={`due mono${overdue ? " overdue" : ""}`}>{formatDue(task.dueDate)}</span>
      </div>
    </div>
  );
}
