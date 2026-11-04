import { describe, expect, it } from "vitest";
import { actualLine, betLine, cleanBet, isLocked, parseAmount, resultMarks, stats, targetPeriod, type BetResult } from "./bets";

describe("분기", () => {
  it("마지막 발표 다음 분기를 예측해요", () => {
    expect(targetPeriod(["2026Q2", "2026Q3"], "2026-11-03")).toBe("2026Q4");
    expect(targetPeriod(["2026Q4"], "2027-01-30")).toBe("2027Q1");
    expect(targetPeriod([], "2026-11-03")).toBe("2026Q3");
    expect(targetPeriod([], "2026-02-10")).toBe("2025Q4");
    expect(isLocked("2026Q3", ["2026Q3"])).toBe(true);
    expect(isLocked("2026Q4", ["2026Q3"])).toBe(false);
  });
});

describe("입력", () => {
  it("단위를 읽어요", () => {
    expect(parseAmount("34.5", "KR")).toBe(34.5e12);
    expect(parseAmount("3,450억", "KR")).toBe(3450e8);
    expect(parseAmount("$35.1B", "US")).toBeCloseTo(35.1e9);
    expect(parseAmount("", "KR")).toBeNull();
    expect(parseAmount("abc", "KR")).toBeNaN();
  });
  it("예측을 정리해요", () => {
    const b = cleanBet({ ticker: "000660", period: "2026Q4", revDir: "up", revValue: "34.5", opDir: "same", pxDir: "down", pxPct: "3", confidence: "72", reason: "  HBM  물량 " }, "KR");
    expect(b).toMatchObject({ revDir: "up", revValue: 34.5e12, opDir: "same", opValue: null, pxDir: "down", pxPct: -3, confidence: 70, reason: "HBM 물량" });
    expect(cleanBet({ ticker: "X", period: "2026Q4" }, "KR")).toHaveProperty("error");
    expect(cleanBet({ ticker: "X", period: "bad", revDir: "up" }, "KR")).toHaveProperty("error");
    expect(cleanBet({ ticker: "X", period: "2026Q4", revValue: "많이" }, "KR")).toHaveProperty("error");
  });
});

const r = (rev: boolean | null, op: boolean | null, px: boolean | null, guess: "up" | "down" = "up"): BetResult => {
  const it = (ok: boolean | null) => ({ guess, actual: 1, est: 1, ok, by: "consensus", pct: 1 });
  const out: BetResult = { rev: it(rev), op: it(op), px: { guess, actual: -2, ok: px }, hits: 0, total: 0 };
  const done = [rev, op, px].filter((x) => x !== null);
  return { ...out, hits: done.filter(Boolean).length, total: done.length };
};

describe("성적", () => {
  it("방향·확신·주가를 세고 버릇을 찾아요", () => {
    const s = stats([
      { result: r(false, true, false), confidence: 80 },
      { result: r(false, true, true), confidence: 90 },
      { result: r(false, false, false), confidence: 85 },
      { result: r(true, true, true), confidence: 60 },
      { result: null, confidence: 70 },
    ]);
    expect(s.scored).toBe(4);
    expect([s.dirHits, s.dirTotal]).toEqual([4, 8]);
    expect([s.pxHits, s.pxTotal]).toEqual([2, 4]);
    expect([s.confHits, s.confTotal]).toEqual([3, 9]);
    expect(s.habits[0]).toContain("매출을 예상보다 높게");
    expect(s.habits.some((h) => h.includes("확신 80%"))).toBe(true);
  });
  it("한 줄 요약", () => {
    expect(betLine({ revDir: "up", opDir: "same", pxDir: "down", confidence: 70 })).toBe("매출 ↑ · 이익 → · 주가 ↓ 70%");
    expect(resultMarks(r(true, false, null))).toEqual([{ label: "매출", ok: true }, { label: "영업이익", ok: false }, { label: "주가", ok: null }]);
    expect(actualLine(null)).toBe("채점 기다리는 중");
    expect(actualLine(r(true, true, true))).toBe("매출 +1.0% · 이익 +1.0% · 주가 −2.0%");
  });
});
