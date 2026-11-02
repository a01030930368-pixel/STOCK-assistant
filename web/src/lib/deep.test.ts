import { describe, expect, it } from "vitest";
import { dupont, dupontSentence, growthLatest, impliedGrowth, impliedSentence, pastGrowth, perHistory, quarters, safety, ttm, valueAt } from "./deep";
import type { StatementRow } from "./statements";
import type { Candle } from "./candles";

const Q = ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2", "2026Q3"];
const rows: StatementRow[] = [];
Q.forEach((p, i) => {
  const rev = 100 + i * 10;
  const add = (item: string, value: number) => rows.push({ kind: "Q", period: p, item, value });
  add("revenue", rev); add("operating_income", rev * 0.3); add("net_income", rev * 0.2); add("cfo", rev * 0.25); add("capex", rev * 0.1);
  add("assets", 1000 + i * 10); add("equity", 500 + i * 10); add("liabilities", 500); add("cash", 100);
});
rows.push({ kind: "Y", period: "2023", item: "net_income", value: 50 }, { kind: "Y", period: "2025", item: "net_income", value: 98 },
  { kind: "Y", period: "2025", item: "revenue", value: 490 }, { kind: "Y", period: "2025", item: "assets", value: 1030 }, { kind: "Y", period: "2025", item: "equity", value: 530 },
  { kind: "Y", period: "2024", item: "assets", value: 970 }, { kind: "Y", period: "2024", item: "equity", value: 470 });

describe("quarters and ttm", () => {
  it("keeps the latest quarters with margin and FCF", () => {
    const q = quarters(rows, 4);
    expect(q.map((r) => r.period)).toEqual(["2025Q4", "2026Q1", "2026Q2", "2026Q3"]);
    expect(q[3]).toMatchObject({ revenue: 160, opm: 30, fcf: 24 });
  });
  it("sums four quarters or gives up on a gap", () => {
    expect(ttm(rows, "revenue")).toBe(130 + 140 + 150 + 160);
    expect(ttm(rows, "revenue", "2025Q2")).toBeNull();
    expect(growthLatest(rows)).toBeCloseTo((160 / 120 - 1) * 100);
  });
});

describe("dupont", () => {
  it("splits ROE into margin, turnover and leverage", () => {
    const d = dupont(rows);
    expect(d.map((x) => x.label)).toEqual(["2025", "최근 4분기"]);
    const now = d.at(-1)!;
    expect(now.margin).toBeCloseTo(20);
    expect(now.roe).toBeCloseTo(now.margin! * now.turnover! * now.leverage!);
    expect(dupontSentence(d)).not.toBe("");
  });
});

describe("safety", () => {
  it("reads debt, cash share, equity growth and cash quality", () => {
    const s = safety(rows, 10000);
    expect(s.debt).toBeCloseTo((500 / 560) * 100);
    expect(s.debtBefore).toBeCloseTo((500 / 520) * 100);
    expect(s.cashQuality).toBeCloseTo(1.25);
    expect(s.fcfTtm).toBeCloseTo(87);
    expect(s.fcfYield).toBeCloseTo(0.87);
    expect(safety([], null).debt).toBeNull();
  });
});

describe("reverse DCF", () => {
  it("finds the growth the price assumes", () => {
    const g = impliedGrowth(valueAt(100, 0.06, 0.09), 100, 0.09)!;
    expect(g).toBeCloseTo(6, 3);
    expect(impliedGrowth(1000, -5, 0.09)).toBeNull();
    expect(impliedGrowth(1e12, 1, 0.09)).toBeNull();
  });
  it("compares with past growth", () => {
    const past = pastGrowth(rows, "net_income")!;
    expect(past.years).toBe(2);
    expect(past.pct).toBeCloseTo((Math.sqrt(98 / 50) - 1) * 100);
    expect(impliedSentence(6, past)).toContain("지난 성장보다 낮은 기대");
    expect(impliedSentence(-3, null)).toContain("줄어드는 것까지");
    expect(impliedSentence(null, null)).toContain("계산하지 않았어요");
  });
});

describe("perHistory", () => {
  it("draws weekly PER from price and trailing EPS", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.parse("2025-06-01") + i * 86400000).toISOString().slice(0, 10);
      candles.push({ day, open: 10, high: 10, low: 10, close: 10 + (i % 20) / 10, volume: 1 });
    }
    const band = perHistory(candles, rows, 100, 12)!;
    expect(band.points.length).toBeGreaterThan(8);
    expect(band.current).toBeCloseTo(12 / ((130 + 140 + 150 + 160) * 0.2 / 100));
    expect(band.low).toBeLessThanOrEqual(band.high);
    expect(perHistory(candles, rows, null, 12)).toBeNull();
  });
});
