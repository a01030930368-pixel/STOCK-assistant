import { describe, expect, it } from "vitest";
import { gapPct, nearest, sparkGeometry, type WatchAlert } from "./watch";

const a = (id: number, price: number, active = true, direction: "above" | "below" = "above"): WatchAlert =>
  ({ id, price, active, direction, memo: "", triggeredAt: null });

describe("watch helpers", () => {
  it("measures the gap to the target", () => {
    expect(gapPct(61200, 58000)).toBe(-5.2);
    expect(gapPct(42.1, 45)).toBe(6.9);
  });
  it("picks the closest active alert", () => {
    expect(nearest([a(1, 70), a(2, 52), a(3, 50, false)], 50)?.id).toBe(2);
    expect(nearest([a(1, 70, false)], 50)).toBeNull();
    expect(nearest([a(4, 70)], null)?.id).toBe(4);
  });
  it("keeps the target line inside the chart", () => {
    const g = sparkGeometry([10, 12, 11], [8], 100, 50);
    expect(g.points).toBe("0,25 50,4 100,14.5");
    expect(g.lines).toEqual([46]);
  });
});
