import { describe, expect, it } from "vitest";
import { lotsHeld, rateOn, splitAll, splitRow, type FxDay, type FxFill } from "./fxsplit";

const days: FxDay[] = [{ day: "2026-03-02", rate: 1300 }, { day: "2026-03-03", rate: 1310 }, { day: "2026-06-01", rate: 1400 }];
const f = (day: string, side: "buy" | "sell", quantity: number, ticker = "NVDA"): FxFill => ({ ticker, day, side, quantity });

describe("fxsplit", () => {
  it("finds the rate on or before a day", () => {
    expect(rateOn(days, "2026-03-04")).toBe(1310); // 휴일은 그 전 영업일
    expect(rateOn(days, "2026-01-01")).toBe(1300); // 기록보다 이르면 가장 이른 기록
    expect(rateOn([], "2026-01-01")).toBeNull();
  });

  it("keeps lots first-in first-out", () => {
    expect(lotsHeld([f("2026-03-02", "buy", 10), f("2026-06-01", "buy", 10), f("2026-06-02", "sell", 12)], 8)).toEqual([{ day: "2026-06-01", quantity: 8 }]);
    expect(lotsHeld([f("2026-03-02", "buy", 10), f("2026-06-01", "buy", 10)], 4)).toEqual([{ day: "2026-06-01", quantity: 4 }]);
  });

  it("splits won profit into price and exchange parts that add up", () => {
    const h = { ticker: "NVDA", name: "NVIDIA", quantity: 20, avg: 100, cur: 120 };
    const r = splitRow(h, [f("2026-03-02", "buy", 10), f("2026-06-01", "buy", 10)], days, 1350);
    expect(r.buyRate).toBe(1350);
    expect(r.price).toBe(20 * 20 * 1350);
    expect(r.fx).toBe(0);
    const r2 = splitRow(h, [f("2026-03-02", "buy", 20)], days, 1400);
    expect(r2.fx).toBe(120 * 20 * 100);
    expect(r2.total).toBeCloseTo(120 * 20 * 1400 - 100 * 20 * 1300);
  });

  it("uses the first record's rate for shares older than the records", () => {
    const h = { ticker: "SPYM", name: "SPYM", quantity: 10, avg: 70, cur: 70 };
    const r = splitRow(h, [f("2026-06-01", "buy", 4, "SPYM")], days, 1400);
    expect(r.unknown).toBe(6);
    expect(r.buyRate).toBe(1400);
    const all = splitAll([h, { ticker: "X", name: "X", quantity: 1, avg: 10, cur: 12 }], [], days, 1400);
    expect(all.unknown).toBe(true);
    expect(all.rows.find((x) => x.ticker === "X")?.buyRate).toBe(1300);
  });
});
