import { nextPosition } from "../board-repo";

describe("nextPosition", () => {
  it("returns 0 when the column is empty (both neighbors undefined)", () => {
    expect(nextPosition(undefined, undefined)).toBe(0);
  });

  it("returns one less than the next task's position when dropped at the start", () => {
    expect(nextPosition(undefined, 5)).toBe(4);
  });

  it("returns one more than the previous task's position when dropped at the end", () => {
    expect(nextPosition(3, undefined)).toBe(4);
  });

  it("returns the midpoint when dropped between two tasks", () => {
    expect(nextPosition(2, 4)).toBe(3);
  });

  it("supports fractional midpoints for tightly packed positions", () => {
    expect(nextPosition(1, 2)).toBe(1.5);
  });

  it("handles negative positions consistently", () => {
    expect(nextPosition(-2, undefined)).toBe(-1);
    expect(nextPosition(undefined, -2)).toBe(-3);
    expect(nextPosition(-4, -2)).toBe(-3);
  });
});
