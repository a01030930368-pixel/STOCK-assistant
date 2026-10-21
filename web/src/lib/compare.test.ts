import { describe, expect, it } from "vitest";
import { dividendYield, growthOf, leader, multiple, parseTickers, rebase } from "./compare";

describe("compare", () => {
  it("parses up to four unique tickers", () => {
    expect(parseTickers("000660, nvda,000660,005930,AAPL,MSFT")).toEqual(["000660", "NVDA", "005930", "AAPL"]);
    expect(parseTickers(undefined)).toEqual([]);
    expect(parseTickers("<x>,TSLA")).toEqual(["TSLA"]);
  });

  it("rebases to 0% and carries closes over the other market's holidays", () => {
    const a = [{ day: "2026-10-01", close: 90 }, { day: "2026-10-02", close: 100 }, { day: "2026-10-05", close: 110 }];
    const b = [{ day: "2026-10-02", close: 50 }, { day: "2026-10-03", close: 55 }, { day: "2026-10-05", close: 60 }];
    const r = rebase([a, b], "2026-10-02");
    expect(r.days).toEqual(["2026-10-02", "2026-10-03", "2026-10-05"]);
    expect(r.values[0]).toEqual([0, 0, expect.closeTo(10, 6)]);
    expect(r.values[1].map((v) => Math.round(v! * 10) / 10)).toEqual([0, 10, 20]);
    expect(rebase([[{ day: "2026-10-05", close: 1 }], a], "2026-10-02").values[0]).toEqual([null, 0]);
  });

  it("picks the better side only when it is clear", () => {
    expect(leader([9.8, 13.4], "low")).toBe(0);
    expect(leader([-3, 12], "low", true)).toBe(null);
    expect(leader([null, 2.3, 0.5], "high")).toBe(1);
    expect(leader([1, 1], "high")).toBe(null);
  });

  it("computes growth, yield and multiples", () => {
    expect(growthOf([{ period: "2024", revenue: 100 }, { period: "2025", revenue: 194 }])).toBeCloseTo(94);
    expect(dividendYield([{ day: "2026-04-01", amount: 361 }, { day: "2025-04-01", amount: 361 }], 64800, "2026-10-21")).toBeCloseTo(0.557, 2);
    expect(dividendYield([], 100, "2026-10-21")).toBe(null);
    expect(multiple([{ from: "2026-05-15", value: 20000 }, { from: "2026-11-14", value: 1 }], 240000, "2026-10-21")).toBe(12);
    expect(multiple([{ from: "2026-05-15", value: -5 }], 100, "2026-10-21")).toBe(null);
  });
});
