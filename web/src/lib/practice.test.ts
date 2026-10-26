import { describe, expect, it } from "vitest";
import { BEFORE, decodeGame, encodeGame, randomStart, rescale, score, STEPS } from "./practice";

describe("practice", () => {
  it("round-trips a game without showing the ticker", () => {
    const g = { ticker: "005930", start: "2024-03-04", blind: true };
    const token = encodeGame(g);
    expect(token).not.toContain("005930");
    expect(decodeGame(token)).toEqual(g);
    expect(decodeGame(encodeGame({ ...g, ticker: "AAPL", blind: false }))).toEqual({ ...g, ticker: "AAPL", blind: false });
    expect(decodeGame("garbage!")).toBeNull();
    expect(decodeGame(undefined)).toBeNull();
  });

  it("random start leaves room before and after", () => {
    const days = Array.from({ length: BEFORE + STEPS + 10 }, (_, i) => `d${i}`);
    expect(randomStart(days, () => 0)).toBe(`d${BEFORE}`);
    expect(randomStart(days, () => 0.9999)).toBe(`d${days.length - 1 - STEPS}`);
    expect(randomStart(days.slice(0, BEFORE + STEPS - 1))).toBeNull();
  });

  it("scores all-in trades, buy and hold, and calls", () => {
    const closes = [100, 100, 110, 120, 90, 100, 100, 100, 100, 100];
    // 1에서 사고(5봉 뒤 100 = 같아서 틀림) 3에서 팔고(120→100 맞음), 4에서 사서 끝까지(100/90)
    const r = score(closes, 0, 9, [{ i: 3, side: "sell" }, { i: 1, side: "buy" }, { i: 1, side: "buy" }, { i: 4, side: "buy" }]);
    expect(r.trades.map((t) => t.i)).toEqual([1, 3, 4]);
    expect(r.returnPct).toBeCloseTo((1.2 * (100 / 90) - 1) * 100, 1);
    expect(r.holdPct).toBe(0);
    expect([r.calls, r.hits]).toEqual([3, 2]);
    expect(score(closes, 0, 9, [{ i: 2, side: "sell" }]).calls).toBe(0);
    // 끝나기 5봉 안에 산 건 5봉 뒤를 못 봐서 맞힘에 안 넣어요(매매로는 셈해요).
    const late = score(closes, 0, 9, [{ i: 5, side: "buy" }, { i: 8, side: "sell" }]);
    expect([late.trades.length, late.calls, late.hits]).toEqual([2, 0, 0]);
    expect(score(closes, 0, 9, [{ i: 4, side: "buy" }]).calls).toBe(1);
  });

  it("rescales to 100 at the start", () => {
    expect(rescale([{ open: 50, high: 60, low: 40, close: 50 }], 50)).toEqual([{ open: 100, high: 120, low: 80, close: 100 }]);
  });
});
