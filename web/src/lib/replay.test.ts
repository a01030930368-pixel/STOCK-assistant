import { describe, expect, it } from "vitest";
import { afterBuy, afterSell, curve, endIndex, valueAt, verdict } from "./replay";

const bars = [
  { day: "2026-09-01", close: 100 }, { day: "2026-09-02", close: 110 }, { day: "2026-09-03", close: 120, high: 125, low: 118 },
  { day: "2026-09-04", close: 90, low: 85 }, { day: "2026-09-07", close: 130 },
];

describe("replay", () => {
  it("tracks my result, the never-sold line and the index", () => {
    const c = curve([
      { day: "2026-09-01", side: "buy", quantity: 10, price: 100, fee: 0 },
      { day: "2026-09-03", side: "sell", quantity: 10, price: 120, fee: 0 },
    ], bars, [{ day: "2026-09-01", close: 2000 }, { day: "2026-09-07", close: 2100 }])!;
    expect(c.days).toHaveLength(5);
    expect(c.mine.map(Math.round)).toEqual([0, 10, 20, 20, 20]);
    expect(c.held.map(Math.round)).toEqual([0, 10, 20, -10, 30]);
    expect(c.bench.map((v) => (v === null ? null : Math.round(v)))).toEqual([0, 0, 0, 0, 5]);
    // 다 판 권은 판 날 기준으로 셋 다 비교해요(그 뒤 지수 +5%, 계속 보유 +30%는 안 세요)
    const i = endIndex(c, "2026-09-03");
    expect([valueAt(c.mine, i), valueAt(c.held, i), valueAt(c.bench, i)].map((v) => Math.round(v!))).toEqual([20, 20, 0]);
    expect(endIndex(c, null)).toBe(4);
    expect(endIndex(c, "2026-09-05")).toBe(3);  // 판 날 일봉이 없으면 그 앞날
  });

  it("handles partial sells and adds", () => {
    const c = curve([
      { day: "2026-09-01", side: "buy", quantity: 10, price: 100, fee: 0 },
      { day: "2026-09-02", side: "sell", quantity: 5, price: 110, fee: 0 },
      { day: "2026-09-04", side: "buy", quantity: 5, price: 90, fee: 0 },
    ], bars, [])!;
    // 9.07: 남은 10주 × 130 + 판 돈 550 = 1850, 넣은 돈 1450
    expect(c.mine.at(-1)).toBeCloseTo((1850 / 1450 - 1) * 100);
    expect(c.held.at(-1)).toBeCloseTo((15 * 130 / 1450 - 1) * 100);
    expect(curve([{ day: "2026-09-01", side: "sell", quantity: 1, price: 1, fee: 0 }], bars, [])).toBe(null);
  });

  it("looks after a sell and after a buy", () => {
    const a = afterSell(bars, "2026-09-02", 110, 2)!;
    expect(a.days).toBe(2);
    expect(a.pct).toBeCloseTo(-18.18, 1);
    expect(verdict(a)).toBe("good");
    expect(afterSell(bars, "2026-09-04", 90)!).toEqual({ pct: expect.closeTo(44.44, 1), days: 1 });
    expect(afterSell(bars, "2026-09-07", 130)).toBe(null);
    expect(afterBuy(bars, "2026-09-01", "2026-09-04", 100)).toEqual({ down: expect.closeTo(-15, 6), up: 25 });
  });
});
