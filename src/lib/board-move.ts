import type { BoardState } from "@/lib/types";
import { nextPosition } from "@/lib/supabase/board-repo";

export interface TaskMoveResult {
  state: BoardState;
  newPosition: number;
}

// Lógica pura de "mover una tarea a (columna, índice)": devuelve el nuevo
// estado del tablero y la posición fraccional que debe guardarse en la BD.
//
// Vive fuera de BoardContext a propósito. Antes este cálculo estaba dentro del
// updater de setState y la posición se leía justo después, fuera de él. React
// solo ejecuta un updater de inmediato si no hay otro update pendiente; con
// handleBulkMove (moveTask en bucle síncrono) desde la 2.ª tarea el updater se
// difería, `newPosition` seguía undefined y moveTaskRemote nunca se llamaba:
// la UI mostraba el movimiento pero no se persistía.
//
// No muta `state` ni `positions`. Devuelve null si la columna destino no
// existe (el llamador no debe hacer nada en ese caso).
export function applyTaskMove(
  state: BoardState,
  positions: Record<string, number>,
  taskId: string,
  toColumnId: string,
  toIndex: number
): TaskMoveResult | null {
  const columns = state.columns.map((col) => ({
    ...col,
    taskIds: col.taskIds.filter((id) => id !== taskId),
  }));
  const target = columns.find((c) => c.id === toColumnId);
  if (!target) return null;

  const clampedIndex = Math.max(0, Math.min(toIndex, target.taskIds.length));
  target.taskIds.splice(clampedIndex, 0, taskId);

  const prevId = target.taskIds[clampedIndex - 1];
  const nextId = target.taskIds[clampedIndex + 1];
  const newPosition = nextPosition(
    prevId ? positions[prevId] : undefined,
    nextId ? positions[nextId] : undefined
  );

  return { state: { ...state, columns }, newPosition };
}
