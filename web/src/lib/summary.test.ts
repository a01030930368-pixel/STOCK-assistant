import { describe, expect, it } from "vitest";
import { summarize, type SummaryInput } from "./summary";

const base: SummaryInput = {
  pnlPct: 3, hasJournal: true, stopDist: 20, targetDist: 30, nextEarnings: null, daysToEarnings: null, lastSurprise: null, recentNews: 0,
};
const texts = (s: Partial<SummaryInput>) => summarize({ ...base, ...s }).map((p) => p.text);

describe("summarize", () => {
  it("puts a near stop first", () => {
    expect(texts({ stopDist: 2.34, recentNews: 2 })).toEqual(["손절가까지 2.3%", "최근 3일 뉴스 2건"]);
  });
  it("mentions upcoming earnings and a missing journal", () => {
    expect(texts({ hasJournal: false, stopDist: null, targetDist: null, nextEarnings: "2026-11-05", daysToEarnings: 4 }))
      .toEqual(["11.5 실적 발표(D-4)", "손절·목표가 없음"]);
  });
  it("leads with a big loss when no stop is set", () => {
    expect(texts({ hasJournal: false, stopDist: null, targetDist: null, pnlPct: -24.34, lastSurprise: -0.05 }))
      .toEqual(["평단 대비 -24.3%", "손절·목표가 없음", "지난 분기 EPS 예상 하회"]);
  });
  it("falls back to profit when nothing else stands out", () => {
    expect(texts({ pnlPct: 7.59 })).toEqual(["평단 대비 +7.6%"]);
  });
  it("keeps at most three parts", () => {
    expect(texts({ stopDist: 1, targetDist: 2, nextEarnings: "2026-10-20", daysToEarnings: 0, recentNews: 5 })).toHaveLength(3);
  });
});
