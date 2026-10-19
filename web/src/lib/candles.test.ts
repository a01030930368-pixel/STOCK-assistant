import { describe, expect, it } from "vitest";
import { aggregate, bucketOf, rsi, sma, type Candle } from "./candles";

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
