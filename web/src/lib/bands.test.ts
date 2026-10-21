import { describe, expect, it } from "vitest";
import { bandSentence, buildBand, perShare } from "./bands";
import type { Candle } from "./candles";
import type { StatementRow } from "./statements";

const rows: StatementRow[] = [
  { kind: "Y", period: "2023", item: "net_income", value: 400 },
  { kind: "Y", period: "2024", item: "net_income", value: 500 },
  ...["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1"].map((p, i) => ({ kind: "Q" as const, period: p, item: "net_income", value: 150 + i * 10 })),
  { kind: "Q", period: "2026Q1", item: "equity", value: 5000 },
];

describe("bands", () => {
  it("uses trailing four quarters after 45 days, annual before that", () => {
    const pts = perShare(rows, 100, "per");
    expect(pts.map((p) => p.from)).toEqual(["2024-03-31", "2025-03-31", "2026-02-14", "2026-05-15"]);
    expect(pts[2].value).toBeCloseTo((150 + 160 + 170 + 180) / 100);
    expect(pts[3].value).toBeCloseTo((160 + 170 + 180 + 190) / 100);
    expect(perShare(rows, 100, "pbr")).toEqual([{ from: "2026-05-15", value: 50 }]);
  });

  it("draws five multiples and places today", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 700; i++) {
      const day = new Date(Date.parse("2024-04-01") + i * 86400000).toISOString().slice(0, 10);
      const close = 40 + 20 * Math.sin(i / 60);
      candles.push({ day, open: close, high: close, low: close, close, volume: null });
    }
    const b = buildBand(candles, perShare(rows, 100, "per"), null, null)!;
    expect(b.lines).toHaveLength(5);
    expect(b.lines[0].mult).toBe(b.low);
    expect(b.lines[4].mult).toBe(b.high);
    expect(b.current).not.toBeNull();
    expect(b.position).toBeGreaterThanOrEqual(0);
    expect(bandSentence(b, "per", 3)).toContain("지난 3년 PER");
  });

  it("gives up without enough history", () => {
    expect(buildBand([], [], 3, null)).toBeNull();
  });
});
