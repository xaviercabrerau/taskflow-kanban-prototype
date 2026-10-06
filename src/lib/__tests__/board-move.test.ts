import { describe, expect, it } from "@jest/globals";
import { applyTaskMove } from "@/lib/board-move";
import type { BoardState, ColumnData } from "@/lib/types";

function column(id: string, taskIds: string[]): ColumnData {
  return { id, title: id, colorVar: "--low", taskIds, isDoneState: false };
}

function stateOf(...columns: ColumnData[]): BoardState {
  return { tasks: {}, columns };
}

describe("applyTaskMove", () => {
  it("coloca la tarea entre sus vecinas y calcula su posición entre ambas", () => {
    const state = stateOf(column("todo", ["a", "b"]), column("doing", ["x"]));
    const positions = { a: 0, b: 1, x: 10 };

    const result = applyTaskMove(state, positions, "x", "todo", 1);

    expect(result).not.toBeNull();
    expect(result!.state.columns.find((c) => c.id === "todo")!.taskIds).toEqual(["a", "x", "b"]);
    expect(result!.state.columns.find((c) => c.id === "doing")!.taskIds).toEqual([]);
    expect(result!.newPosition).toBe(0.5);
  });

  it("al mover a una columna vacía usa la posición 0", () => {
    const state = stateOf(column("todo", ["a"]), column("done", []));

    const result = applyTaskMove(state, { a: 5 }, "a", "done", 0);

    expect(result!.state.columns.find((c) => c.id === "done")!.taskIds).toEqual(["a"]);
    expect(result!.newPosition).toBe(0);
  });

  it("recorta un índice fuera de rango al final de la columna", () => {
    const state = stateOf(column("todo", ["a", "b"]), column("doing", ["x"]));

    const result = applyTaskMove(state, { a: 0, b: 1, x: 10 }, "x", "todo", 99);

    expect(result!.state.columns.find((c) => c.id === "todo")!.taskIds).toEqual(["a", "b", "x"]);
    expect(result!.newPosition).toBe(2);
  });

  it("mueve dentro de la misma columna", () => {
    const state = stateOf(column("todo", ["a", "b", "c"]));

    const result = applyTaskMove(state, { a: 0, b: 1, c: 2 }, "a", "todo", 2);

    expect(result!.state.columns[0].taskIds).toEqual(["b", "c", "a"]);
    expect(result!.newPosition).toBe(3);
  });

  it("devuelve null si la columna destino no existe", () => {
    const state = stateOf(column("todo", ["a"]));

    expect(applyTaskMove(state, { a: 0 }, "a", "no-existe", 0)).toBeNull();
  });

  it("no muta el estado ni las posiciones recibidas", () => {
    const state = stateOf(column("todo", ["a", "b"]), column("doing", ["x"]));
    const positions = { a: 0, b: 1, x: 10 };
    const snapshotState = JSON.parse(JSON.stringify(state));
    const snapshotPositions = { ...positions };

    applyTaskMove(state, positions, "x", "todo", 1);

    expect(state).toEqual(snapshotState);
    expect(positions).toEqual(snapshotPositions);
  });

  // Regresión del bug de "mover en lote": handleBulkMove llama a moveTask en
  // bucle síncrono. Antes la posición se calculaba dentro de un updater de
  // setState y se leía justo después; con un update ya pendiente (desde la
  // 2.ª tarea) quedaba undefined y NUNCA se llamaba a moveTaskRemote: la UI
  // mostraba el movimiento pero no se guardaba. Con esta función cada paso
  // devuelve su posición de forma síncrona, encadenando el resultado anterior.
  describe("movimiento en lote (pasos encadenados)", () => {
    it("cada tarea recibe su posición y el orden final es el esperado", () => {
      let state = stateOf(
        column("todo", ["s1", "s2", "s3", "s4"]),
        column("done", ["d1", "d2"])
      );
      const positions: Record<string, number> = { s1: 0, s2: 1, s3: 2, s4: 3, d1: 0, d2: 1 };
      const selected = ["s1", "s3", "s4"];

      const destLen = state.columns.find((c) => c.id === "done")!.taskIds.length;
      let offset = 0;
      const assigned: number[] = [];
      for (const taskId of selected) {
        const result = applyTaskMove(state, positions, taskId, "done", destLen + offset);
        // Ningún paso puede quedarse sin posición (el bug dejaba undefined).
        expect(result).not.toBeNull();
        state = result!.state;
        positions[taskId] = result!.newPosition;
        assigned.push(result!.newPosition);
        offset++;
      }

      expect(state.columns.find((c) => c.id === "done")!.taskIds).toEqual([
        "d1", "d2", "s1", "s3", "s4",
      ]);
      expect(state.columns.find((c) => c.id === "todo")!.taskIds).toEqual(["s2"]);
      // Posiciones estrictamente crecientes: el orden en la BD coincide con la UI.
      expect([...assigned].sort((x, y) => x - y)).toEqual(assigned);
      expect(new Set(assigned).size).toBe(assigned.length);
      expect(assigned.every((p) => p > positions.d2)).toBe(true);
    });
  });
});
