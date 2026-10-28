import { describe, expect, it } from "vitest";
import { ago, combine, mine, prevClose, quoteFrom, quoteOf } from "./live";

describe("live price line", () => {
  it("uses the close before today as the previous close", () => {
    const c = [{ day: "2026-10-23", close: 66000 }, { day: "2026-10-24", close: 67200 }, { day: "2026-10-27", close: 68400 }];
    expect(prevClose(c, "2026-10-27")).toBe(67200);
    expect(prevClose(c, "2026-10-28")).toBe(68400);
    expect(prevClose([], "2026-10-27")).toBeNull();
    const q = quoteFrom(68400, 67200);
    expect(q.change).toBe(1200);
    expect(q.pct).toBeCloseTo(1.7857, 3);
    expect(quoteFrom(1, null).pct).toBeNull();
  });

  it("reads the worker value", () => {
    expect(quoteOf({ price: 41.1, change: 0.5, change_pct: 1.23 })).toEqual({ price: 41.1, change: 0.5, pct: 1.23 });
    expect(quoteOf({ error: "x" })).toBeNull();
    expect(quoteOf(null)).toBeNull();
  });

  it("says how long ago", () => {
    const at = "2026-10-27T02:00:00Z", t = Date.parse(at);
    expect(ago(at, t + 2000)).toBe("2초 전");
    expect(ago(at, t + 125_000)).toBe("2분 전");
    expect(ago(undefined, t)).toBe("");
  });

  it("computes my profit with a weighted average", () => {
    const h = combine([{ quantity: 10, avg: 60000 }, { quantity: 10, avg: 62400 }]);
    expect(h).toEqual({ quantity: 20, avg: 61200 });
    expect(mine(h, 68400)!.pnl).toBe(144000);
    expect(mine(h, 68400)!.pct).toBeCloseTo(11.76, 2);
    expect(mine(null, 1)).toBeNull();
    expect(combine([])).toBeNull();
  });
});
