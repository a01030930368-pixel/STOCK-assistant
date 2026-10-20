import { describe, expect, it } from "vitest";
import { byReason, byRules, monthly, since, summarize, type Sale } from "./stats";

const sale = (tradeDate: string, returnPct: number, holdingDays: number, reasonType: Sale["reasonType"], followedRules: boolean): Sale =>
  ({ tradeDate, ticker: "X", name: "X", returnPct, holdingDays, reasonType, followedRules, lesson: "" });

const S = [
  sale("2026-10-14", 18.4, 41, "target", true),
  sale("2026-10-09", -8.1, 12, "stop", true),
  sale("2026-09-30", -14.6, 23, "other", false),
  sale("2026-08-22", 11.2, 66, "target", true),
];

describe("summarize", () => {
  it("computes win rate, averages and payoff", () => {
    const s = summarize(S);
    expect(s).toMatchObject({ count: 4, wins: 2, winRate: 50, avgWin: 14.8, avgLoss: -11.35, payoff: 1.3, avgDays: 36, avgDaysWin: 54, avgDaysLoss: 18, worst: -14.6 });
  });
  it("handles no trades", () => {
    expect(summarize([])).toMatchObject({ count: 0, winRate: null, payoff: null, worst: null });
  });
  it("has no payoff when there were no losses", () => {
    expect(summarize([S[0]]).payoff).toBeNull();
  });
});

describe("groups", () => {
  it("splits by rules and reason", () => {
    expect(byRules(S).broken.count).toBe(1);
    expect(byRules(S).kept.winRate).toBe(66.7);
    expect(byReason(S).target.avgReturn).toBe(14.8);
    expect(byReason(S).other.count).toBe(1);
  });
});

describe("periods", () => {
  it("filters by months back", () => {
    expect(since(S, "2026-10-20", 1).length).toBe(3); // 09-20 이후
    expect(since(S, "2026-10-20", null).length).toBe(4);
  });
  it("fills empty months", () => {
    expect(monthly(S, "2026-10-20", 3)).toEqual([
      { month: "2026-08", count: 1, avgReturn: 11.2 },
      { month: "2026-09", count: 1, avgReturn: -14.6 },
      { month: "2026-10", count: 2, avgReturn: 5.15 },
    ]);
  });
});
