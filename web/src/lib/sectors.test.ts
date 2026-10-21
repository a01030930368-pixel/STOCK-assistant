import { describe, expect, it } from "vitest";
import { closeOn, heat, mine, norm, returns, signed, treemap } from "./sectors";

const closes = [
  { day: "2025-12-30", close: 80 }, { day: "2026-07-21", close: 90 }, { day: "2026-09-19", close: 95 },
  { day: "2026-10-14", close: 98 }, { day: "2026-10-20", close: 99 }, { day: "2026-10-21", close: 100 },
];

describe("sectors", () => {
  it("finds the last close on or before a day", () => {
    expect(closeOn(closes, "2026-10-15")).toBe(98);
    expect(closeOn(closes, "2025-01-01")).toBeNull();
  });

  it("builds period returns from the current price", () => {
    const r = returns(100, 1.04, closes, "2026-10-21");
    expect(r).toEqual({ d1: 1, w1: 2, m1: 5.3, m3: 11.1, ytd: 25 });
  });

  it("leaves a period blank when history is too short", () => {
    const r = returns(100, 0, closes.slice(3), "2026-10-21");
    expect(r.m1).toBeNull();
    expect(r.ytd).toBeNull();
  });

  it("matches KR sector names loosely and maps US industries", () => {
    expect(norm("전기·전자")).toBe(norm("전기전자"));
    const kr = mine("KR", [{ code: "013", name: "전기·전자" }, { code: "021", name: "금융업" }], [
      { name: "SK하이닉스", sector: "전기전자", amount: 300, pnlPct: 0 },
      { name: "KB금융", sector: "금융", amount: 100, pnlPct: 0 },
      { name: "모름", sector: null, amount: 600, pnlPct: 0 },
    ]);
    expect(kr.get("013")).toEqual({ count: 1, pct: 30, names: ["SK하이닉스"] });
    expect(kr.get("021")?.count).toBe(1);
    const us = mine("US", [], [{ name: "NVDA", sector: "반도체", amount: 1, pnlPct: 0 }]);
    expect(us.get("XLK")?.pct).toBe(100);
  });

  it("lays out boxes that fill the area", () => {
    const boxes = treemap([{ weight: 2, item: "a" }, { weight: 1, item: "b" }, { weight: 1, item: "c" }], 0, 0, 400, 200);
    expect(boxes.map((b) => b.item)).toEqual(["a", "b", "c"]);
    expect(boxes[0]).toMatchObject({ x: 0, y: 0, w: 200, h: 200 });
    expect(boxes.reduce((s, b) => s + b.w * b.h, 0)).toBeCloseTo(80000);
  });

  it("formats and colors", () => {
    expect(signed(-1.24)).toBe("−1.2%");
    expect(signed(null)).toBe("–");
    expect(heat(3, "d1")).toContain("232, 128, 111, 0.61");
    expect(heat(0, "d1")).toBeUndefined();
  });
});
