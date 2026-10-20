import { describe, expect, it } from "vitest";
import { breaches, weights, type HoldingIn } from "./weights";

const H: HoldingIn[] = [
  { ticker: "000660", name: "SK하이닉스", market: "KR", evalAmount: 4_000_000, pnlPct: 18, sector: "전기전자" },
  { ticker: "NVDA", name: "NVDA", market: "US", evalAmount: 2_000, pnlPct: 31, sector: "반도체" },
  { ticker: "196170", name: "알테오젠", market: "KR", evalAmount: 1_000_000, pnlPct: 12, sector: null },
];

describe("weights", () => {
  const w = weights(H, 1_400, 600_000, 300); // NVDA 2,800,000원, 현금 1,020,000원 → 합계 8,820,000원
  it("converts dollars and sums", () => {
    expect(w.total).toBe(8_820_000);
    expect(w.stocks.map((s) => [s.label, s.pct])).toEqual([["SK하이닉스", 45.4], ["NVDA", 31.7], ["알테오젠", 11.3], ["현금", 11.6]]);
  });
  it("groups by sector and market", () => {
    expect(w.sectors.map((s) => s.label)).toEqual(["전기전자", "반도체", "현금", "업종 미확인"]);
    expect(w.markets.map((m) => [m.label, m.pct])).toEqual([["국내", 56.7], ["해외", 31.7], ["현금", 11.6]]);
  });
  it("lists limit breaches", () => {
    expect(breaches(w, { sectorMax: 40, stockMax: 30, cashMin: 15 })).toEqual([
      "전기전자 업종이 45.4%로 한도 40%를 넘었어요.",
      "SK하이닉스 비중이 45.4%로 한 종목 한도 30%를 넘었어요.",
      "NVDA 비중이 31.7%로 한 종목 한도 30%를 넘었어요.",
      "현금이 11.6%로 최소 15%보다 적어요.",
    ]);
  });
  it("is empty without anything", () => {
    expect(weights([], 1400, 0, 0).total).toBe(0);
  });
});
