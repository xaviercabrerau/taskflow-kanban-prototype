// Genera ids temporales únicos para tareas creadas en el cliente antes de
// que la base de datos les asigne su id real (ver insertTask en
// board-repo.ts). Se centraliza aquí porque Board.tsx, TableView.tsx y
// GanttView.tsx necesitaban cada uno un id temporal para el optimistic
// update de addTask().
let counter = 0;

export function generateTempId(): string {
  counter += 1;
  return `t${Date.now()}-${counter}`;
}
