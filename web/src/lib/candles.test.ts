import { describe, expect, it } from "vitest";
import { aggregate, aggregateMinutes, bucketOf, rsi, sma, wallClock, type Candle, type MinuteCandle } from "./candles";

const c = (day: string, open: number, high: number, low: number, close: number, volume: number | null = 10): Candle => ({ day, open, high, low, close, volume });

describe("candles", () => {
  it("buckets weeks by Monday and months by the 1st", () => {
    expect(bucketOf("2026-10-18", "W")).toBe("2026-10-12"); // 일요일
    expect(bucketOf("2026-10-19", "W")).toBe("2026-10-19"); // 월요일
    expect(bucketOf("2026-10-19", "M")).toBe("2026-10-01");
  });

  it("aggregates weekly OHLCV", () => {
    const w = aggregate([c("2026-10-13", 10, 12, 9, 11), c("2026-10-14", 11, 15, 10, 14, 5), c("2026-10-19", 14, 14, 13, 13)], "W");
    expect(w).toEqual([c("2026-10-12", 10, 15, 9, 14, 15), c("2026-10-19", 14, 14, 13, 13)]);
  });

  it("does not mutate daily input", () => {
    const d = [c("2026-10-13", 10, 12, 9, 11), c("2026-10-14", 11, 15, 10, 14)];
    aggregate(d, "W");
    expect(d[0].high).toBe(12);
  });

  it("computes sma and rsi", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(rsi(up)[19]).toBe(100);
    expect(rsi(up)[13]).toBeNull();
  });
});

describe("minute candles", () => {
  const m = (hh: number, mm: number, close: number, volume = 1): MinuteCandle => {
    const t = Date.UTC(2026, 9, 20, hh, mm) / 1000;
    return { t, open: close, high: close + 1, low: close - 1, close, volume };
  };

  it("converts to market wall clock", () => {
    expect(wallClock(new Date("2026-10-20T00:01:00Z"), "Asia/Seoul")).toBe(Date.UTC(2026, 9, 20, 9, 1) / 1000);
    expect(wallClock(new Date("2026-10-20T13:30:00Z"), "America/New_York")).toBe(Date.UTC(2026, 9, 20, 9, 30) / 1000);
  });

  it("buckets from the session open", () => {
    const us = aggregateMinutes([m(9, 30, 10), m(10, 29, 12, 2), m(10, 30, 11)], 60, 9.5 * 3600);
    expect(us.map((b) => [new Date(b.t * 1000).toISOString().slice(11, 16), b.close, b.volume, b.high])).toEqual([["09:30", 12, 3, 13], ["10:30", 11, 1, 12]]);
    const kr = aggregateMinutes([m(9, 0, 1), m(9, 2, 2), m(9, 3, 3)], 3, 9 * 3600);
    expect(kr.map((b) => b.close)).toEqual([2, 3]);
  });

  it("keeps one 1-minute bar when the same minute arrives twice", () => {
    const one = aggregateMinutes([m(9, 30, 10), m(9, 31, 11), m(9, 31, 12)], 1, 9.5 * 3600);
    expect(one.map((b) => b.close)).toEqual([10, 12]);
  });
});
