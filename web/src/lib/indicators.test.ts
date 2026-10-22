import { describe, expect, it } from "vitest";
import { cleanSettings, DEFAULTS, divergences, ema, ichimoku, macd, obv, patterns, stochastic, volumeProfile, vwap, type Ohlcv } from "./indicators";

const bar = (close: number, o?: Partial<Ohlcv>): Ohlcv => ({ open: close, high: close, low: close, close, volume: 100, ...o });

describe("indicators", () => {
  it("ema starts from the simple average", () => {
    expect(ema([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
    expect(ema([null, 2, 4, 6], 2)).toEqual([null, null, 3, 5]);
  });

  it("macd line is fast minus slow ema", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(closes);
    expect(m[32]).toBeNull(); // 느린 선이 25번째, 신호선은 그 뒤 9개째(33번째)부터 있어요
    expect(m[33]).not.toBeNull();
    expect(m[59]!.macd).toBeGreaterThan(0);
    expect(m[59]!.hist).toBeCloseTo(m[59]!.macd - m[59]!.signal);
  });

  it("stochastic sits at 100 when closing at the top", () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(10 + i, { low: 9 + i, high: 10 + i }));
    const s = stochastic(bars);
    expect(s[14]).toBeNull();
    expect(s[29]).toEqual({ k: 100, d: 100 });
  });

  it("obv adds on up days and subtracts on down days", () => {
    expect(obv([bar(10), bar(11, { volume: 5 }), bar(9, { volume: 3 }), bar(9, { volume: 7 })])).toEqual([0, 5, 2, 2]);
  });

  it("ichimoku spans", () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(i, { low: i - 1, high: i + 1 }));
    const k = ichimoku(bars);
    expect(k.tenkan[8]).toBe((9 + -1) / 2);
    expect(k.spanB[50]).toBeNull();
    expect(k.spanA[59]).toBe(((59 + 1 + 51 - 1) / 2 + (59 + 1 + 34 - 1) / 2) / 2);
  });

  it("vwap resets per group and skips bars before from", () => {
    const bars = [bar(10, { high: 10, low: 10, volume: 1 }), bar(20, { high: 20, low: 20, volume: 3 }), bar(30, { high: 30, low: 30, volume: 1 })];
    expect(vwap(bars)).toEqual([10, 17.5, 20]);
    expect(vwap(bars, (i) => (i < 2 ? "a" : "b"))).toEqual([10, 17.5, 30]);
    expect(vwap(bars, () => "", 1)).toEqual([null, 20, 22.5]);
  });

  it("volume profile spreads each bar over its range", () => {
    const p = volumeProfile([bar(10, { low: 10, high: 12, volume: 100 }), bar(11, { low: 11, high: 11.5, volume: 50 })], 4);
    expect(p.map((b) => Math.round(b.volume))).toEqual([25, 25, 25 + 50, 25]);
    expect(volumeProfile([bar(1, { volume: 0 })])).toEqual([]);
  });

  it("finds a hammer only after a fall", () => {
    const fall = Array.from({ length: 26 }, (_, i) => bar(100 - i * 2, { open: 101 - i * 2, high: 101.5 - i * 2, low: 99.5 - i * 2 }));
    const hammer = bar(50.5, { open: 50, high: 50.6, low: 46 });
    expect(patterns([...fall, hammer]).at(-1)).toEqual({ i: 26, key: "hammer" });
    const flat = Array.from({ length: 26 }, () => bar(50, { open: 50.2, high: 51, low: 49 }));
    expect(patterns([...flat, hammer]).some((p) => p.i === 26)).toBe(false);
  });

  it("bearish divergence: higher high, lower rsi", () => {
    const highs = [1, 2, 3, 4, 5, 10, 5, 4, 3, 2, 1, 2, 3, 4, 5, 11, 5, 4, 3, 2, 1];
    const bars = highs.map((h) => bar(h, { high: h, low: h - 1 }));
    const r = highs.map((_, i) => (i === 5 ? 80 : i === 15 ? 65 : 50));
    expect(divergences(bars, r)).toEqual([{ a: 5, b: 15, kind: "bear" }]);
  });

  it("cleans saved settings", () => {
    expect(cleanSettings(null)).toEqual(DEFAULTS);
    expect(cleanSettings({ ma: [10, "x", 10, 50], bb: [20, 9], rsi: 1, macd: [30, 20, 9], stoch: [9, 3] }))
      .toEqual({ ma: [10, 50], bb: [20, 2], rsi: 14, macd: [12, 26, 9], stoch: [9, 3] });
  });
});
