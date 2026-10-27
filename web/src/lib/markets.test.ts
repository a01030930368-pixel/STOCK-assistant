import { describe, expect, it } from "vitest";
import { cardData, dir, fearGreedWord, fmtChange, fmtValue, indexed, isDoubleTap, metaOf, slice, sparkPath, type Point } from "./markets";

const days = (n: number, start = "2026-01-01", f = (i: number) => 100 + i): Point[] =>
  Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), close: f(i) }));

describe("markets", () => {
  it("slices by period from the last day, keeping one point before", () => {
    const pts = days(400);
    const m1 = slice(pts, "1m");
    expect(m1.at(-1)!.day).toBe(pts.at(-1)!.day);
    expect(m1.length).toBe(33); // 31일 전 그날 + 앞 봉 하나 + ... 마지막
    expect(slice([], "3m")).toEqual([]);
  });

  it("card changes: pct for indexes, %p for rates", () => {
    const kospi = cardData(metaOf("KOSPI")!, days(100, "2026-01-01", (i) => 2000 + i * 10), "1m");
    expect(kospi.day!.pct).toBeCloseTo((2990 / 2980 - 1) * 100);
    expect(fmtChange(kospi.meta, kospi.day)).toBe("+0.3%");
    const rate = cardData(metaOf("US10Y")!, [{ day: "2026-10-22", close: 4.2 }, { day: "2026-10-23", close: 4.15 }], "1m");
    expect(fmtChange(rate.meta, rate.day)).toBe("-0.05%p");
    expect(fmtValue(rate.meta, 4.15)).toBe("4.15%");
    expect(fmtValue(metaOf("BTC")!, 67410.4)).toBe("$67,410");
    expect(cardData(metaOf("SOX")!, [], "1y").last).toBeNull();
  });

  it("indexes overlay lines to 100 from a common start", () => {
    const a = indexed([{ day: "2026-01-01", close: 50 }, { day: "2026-01-02", close: 55 }, { day: "2026-01-03", close: 60 }], "2026-01-02");
    expect(a.map((p) => p.close)).toEqual([100, (60 / 55) * 100]);
    expect(indexed([], "2026-01-01")).toEqual([]);
  });

  it("spark path includes the reference line in range", () => {
    const { line, refY } = sparkPath([{ day: "a", close: 15 }, { day: "b", close: 18 }], 100, 40, 20);
    expect(line).toBe("0.0,40.0 100.0,16.0");
    expect(refY).toBe(0);
  });

  it("detects a double tap on the same card only", () => {
    expect(isDoubleTap({ code: "SPX", at: 1000 }, "SPX", 1300)).toBe(true);
    expect(isDoubleTap({ code: "SPX", at: 1000 }, "SPX", 1500)).toBe(false);
    expect(isDoubleTap({ code: "SPX", at: 1000 }, "VIX", 1100)).toBe(false);
    expect(isDoubleTap(null, "SPX", 1)).toBe(false);
  });
});

describe("fear & greed", () => {
  it("names CNN bands and shows point changes", () => {
    expect([10, 30, 50, 60, 90].map(fearGreedWord)).toEqual(["극단적 공포", "공포", "중립", "탐욕", "극단적 탐욕"]);
    const m = metaOf("FEARGREED")!;
    const c = cardData(m, [{ day: "2026-10-23", close: 55.2 }, { day: "2026-10-26", close: 61.9 }], "1m");
    expect(fmtValue(m, 61.9)).toBe("62");
    expect(fmtChange(m, c.day)).toBe("+7");
    expect(dir(m, c.day)).toBe("up");
  });
});
