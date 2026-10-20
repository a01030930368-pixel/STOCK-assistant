import { describe, expect, it } from "vitest";
import { kindFor, nearest, strokeDistance, thin, validDoodle, zone, type Mark } from "./drawings";

const mark = (id: number, low: number, high: number | null = null): Mark => ({ id, kind: "support", low, high, memo: "", alert: false });

describe("drawings", () => {
  it("picks support or resistance from the current price", () => {
    expect(kindFor(220, null, 212)).toBe("resistance");
    expect(kindFor(206, null, 212)).toBe("support");
    expect(kindFor(210, 216, 212)).toBe("resistance");
    expect(zone(222, 218)).toEqual({ low: 218, high: 222 });
  });

  it("finds the closest level above and below", () => {
    const marks = [mark(1, 232), mark(2, 218, 222), mark(3, 206), mark(4, 190, 194), mark(5, 210, 214)];
    const n = nearest(marks, 212);
    expect(n.above?.mark.id).toBe(2);
    expect(n.above?.pct).toBeCloseTo(2.83, 1);
    expect(n.below?.mark.id).toBe(3);
  });

  it("measures distance to a stroke", () => {
    expect(strokeDistance([5, 3], [[0, 0], [10, 0]])).toBe(3);
    expect(strokeDistance([13, 4], [[0, 0], [10, 0]])).toBe(5);
    expect(strokeDistance([1, 1], [[1, 4]])).toBe(3);
  });

  it("thins close points but keeps the ends", () => {
    expect(thin([[0, 0], [1, 0], [3, 0], [3.5, 0]])).toEqual([0, 2, 3]);
  });

  it("validates doodle points", () => {
    expect(validDoodle([["2026-10-20", 0, 212000]])).toBe(true);
    expect(validDoodle([])).toBe(false);
    expect(validDoodle([["x", "0", 1]])).toBe(false);
    expect(validDoodle([["x", 0, -1]])).toBe(false);
  });
});
