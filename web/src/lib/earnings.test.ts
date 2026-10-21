import { describe, expect, it } from "vitest";
import { change, gaugePos, margin, surprise, title, type ReportData } from "./earnings";

describe("earnings", () => {
  it("compares with signs and turnarounds", () => {
    expect(change(119, 100)).toEqual({ text: "+19%", tone: "up" });
    expect(change(95, 100)).toEqual({ text: "−5%", tone: "down" });
    expect(change(5, -3)).toEqual({ text: "흑자 전환", tone: "up" });
    expect(change(-1, 3)).toEqual({ text: "적자 전환", tone: "down" });
    expect(change(1, null)).toBeNull();
  });
  it("computes margin, surprise and gauge", () => {
    const d = { lines: { revenue: { cur: 100, prev: 90, yoy: 80 }, operating_income: { cur: 42, prev: 40, yoy: 38 } } } as unknown as ReportData;
    expect(Math.round(margin(d, "cur")!)).toBe(42);
    expect(surprise(1.3, 1.25)!).toBeCloseTo(4);
    expect(surprise(-0.1, -0.2)!).toBeCloseTo(50);
    expect(gaugePos(3.3)).toBeCloseTo(66.5);
    expect(gaugePos(-30)).toBe(5);
  });
  it("titles KR and US periods", () => {
    expect(title({ period: "2026Q3", market: "KR" })).toBe("3분기 잠정 실적");
    expect(title({ period: "2027Q3", market: "US" })).toBe("3분기 실적 · 회계연도 27년");
  });
});
