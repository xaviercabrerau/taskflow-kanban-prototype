"use client";

import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ColumnData, Task } from "@/lib/types";
import { useBoard } from "@/context/BoardContext";
import TaskCard from "./TaskCard";

interface ColumnProps {
  column: ColumnData;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onAddTask: (columnId: string) => void;
}

function Column({ column, tasks, onOpenTask, onAddTask }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { columnId: column.id } });
  const { can } = useBoard();

  return (
    <div className={`col${isOver ? " drop-active" : ""}`}>
      <div className="col-head">
        <span className="col-dot" style={{ background: `var(${column.colorVar})` }} />
        <span className="col-title">{column.title}</span>
        <span className="col-count mono">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="cards">
        {/* items debe reflejar lo que realmente se renderiza abajo (`tasks`,
            ya filtrado por Board), no `column.taskIds` completo — si no,
            dnd-kit registra ids sin nodo DOM correspondiente cuando el
            filtro por persona oculta tareas, y el reordenamiento al
            arrastrar queda mal calculado. */}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} columnId={column.id} onOpen={onOpenTask} />
          ))}
        </SortableContext>
      </div>
      {can("task.create") && (
        <button className="add-task" onClick={() => onAddTask(column.id)}>
          ＋ Añadir tarea
        </button>
      )}
    </div>
  );
}

export default memo(Column);
