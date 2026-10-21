import { describe, expect, it } from "vitest";
import { buildCells, cautionCell, chartCell, counts, earningsCell, flowCell, newsCell, valueCell } from "./brief";
import type { Candle } from "./candles";

const day = (i: number) => new Date(Date.parse("2026-01-01") + i * 86400000).toISOString().slice(0, 10);
const candles = (closes: number[]): Candle[] => closes.map((c, i) => ({ day: day(i), open: c, high: c, low: c, close: c, volume: 1 }));

describe("brief cells", () => {
  it("says why it used PBR", () => {
    const base = { candles: candles(Array.from({ length: 120 }, (_, i) => 100 + i)), shares: 10, price: null };
    const equity = { kind: "Y" as const, period: "2024", item: "equity", value: 1000 };
    const loss = valueCell({ ...base, statements: [equity, { kind: "Y", period: "2024", item: "net_income", value: -50 }] });
    expect(loss.text).toContain("적자라 PER 대신 PBR");
    const missing = valueCell({ ...base, statements: [equity] });
    expect(missing.text).toContain("순이익 자료가 모자라");
    expect(missing.text).not.toContain("적자");
  });

  it("earnings from quarterly statements", () => {
    const q = (period: string, v: number) => ({ kind: "Q" as const, period, item: "operating_income", value: v });
    const c = earningsCell({ report: null, market: "KR", statements: [q("2025Q2", 80e9), q("2025Q3", 100e9), q("2026Q2", 100e9), q("2026Q3", 138e9)] });
    expect(c.signal).toBe("g");
    expect(c.text).toBe("26.3Q 영업이익 1,380억, 1년 전보다 +38%. 2분기 연속 늘었어요.");
    expect(earningsCell({ report: null, market: "KR", statements: [] }).signal).toBe("n");
  });

  it("flows need both foreign and institution buying for green", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ day: day(i), close: 1, foreign: 1000, institution: i < 10 ? -500 : 100, individual: 0 }));
    const c = flowCell({ market: "KR", flows: rows });
    expect(c.signal).toBe("y");
    expect(c.text).toContain("외국인이 20일 연속 사는 중이에요");
    expect(flowCell({ market: "US", flows: [] }).signal).toBe("n");
  });

  it("chart position", () => {
    const up = Array.from({ length: 120 }, (_, i) => 100 + i);
    expect(chartCell({ candles: candles(up), price: null }).signal).toBe("y"); // 계속 올라 RSI 100
    const down = Array.from({ length: 120 }, (_, i) => 300 - i);
    const c = chartCell({ candles: candles(down), price: null });
    expect(c.signal).toBe("r");
    expect(c.text).toContain("20일선·60일선 아래");
    expect(chartCell({ candles: candles([1, 2]), price: null }).signal).toBe("n");
  });

  it("news and caution", () => {
    expect(newsCell({ market: "KR", today: "2026-10-21", newsDays: ["2026-10-20", "2026-10-01"], filings: [{ kind: "rights", day: "2026-10-10" }] }).signal).toBe("r");
    const quiet = newsCell({ market: "KR", today: "2026-10-21", newsDays: [], filings: [{ kind: "stake", day: "2026-10-10" }] });
    expect(quiet).toMatchObject({ signal: "g", text: "30일 동안 눈에 띄는 공시는 없어요, 7일 뉴스 0건." });
    const c = cautionCell({ today: "2026-10-21", candles: [], price: null, events: [
      { day: "2026-10-29", kind: "policy", title: "FOMC", ticker: "" }, { day: "2026-10-28", kind: "earnings", title: "실적", ticker: "000660" },
    ] });
    expect(c).toMatchObject({ signal: "y", text: "10.28 실적 발표." }); // FOMC는 7일 밖
  });

  it("builds six cells", () => {
    const cells = buildCells({ market: "US", price: null, today: "2026-10-21", candles: [], statements: [], shares: null, report: null, flows: [], filings: [], newsDays: [], events: [] });
    expect(cells.map((c) => c.key)).toEqual(["earnings", "flow", "chart", "value", "news", "caution"]);
    expect(counts(cells)).toBe("초록 2 · 노랑 0 · 빨강 0");
  });
});
