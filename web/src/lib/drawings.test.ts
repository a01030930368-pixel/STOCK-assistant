import { describe, expect, it } from "vitest";
import { kindFor, markColor, validColor, moveEdge, nearest, snap, strokeDistance, thin, validDoodle, zone, type Mark } from "./drawings";

const mark = (id: number, low: number, high: number | null = null): Mark => ({ id, kind: "support", low, high, memo: "", alert: false, color: null });

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

  it("snaps to the closest candle price on screen", () => {
    const toY = (p: number) => 1000 - p; // 가격 1 = 1픽셀
    expect(snap(500, [495, 503, 520], toY, 8)).toBe(503);
    expect(snap(500, [480, 520], toY, 8)).toBeNull();
  });

  it("moves a line or a zone edge", () => {
    expect(moveEdge(mark(1, 10), "low", 12)).toMatchObject({ low: 12, high: null });
    expect(moveEdge(mark(1, 10, 20), "high", 25)).toMatchObject({ low: 10, high: 25 });
    expect(moveEdge(mark(1, 10, 20), "high", 5)).toMatchObject({ low: 5, high: 10 });
  });

  it("uses the picked color or the kind's color", () => {
    expect(markColor({ kind: "support", color: null })).toBe("#86a8e6");
    expect(markColor({ kind: "resistance", color: "#c9a96b" })).toBe("#c9a96b");
    expect(validColor("#C9A96B")).toBe(true);
    expect(validColor(null)).toBe(true);
    expect(validColor("red")).toBe(false);
  });
});
