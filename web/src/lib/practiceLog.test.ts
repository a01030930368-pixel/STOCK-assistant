import { describe, expect, it } from "vitest";
import { filterSessions, habits, insights, summarize, won, type Session } from "./practiceLog";

let n = 0;
const s = (mine: number, hold: number, over: Partial<Session> = {}): Session => ({
  id: ++n, ticker: "005930", name: "삼성전자", start: "2024-01-02", end: "2024-03-29", blind: true, trades: [], mine, hold,
  calls: 4, hits: 2, played: "2026-10-24", ...over,
});
const buy = (day: string) => ({ day, side: "buy" as const, price: 100 });
const sell = (day: string) => ({ day, side: "sell" as const, price: 100 });

describe("practice log", () => {
  it("summarizes wins against just holding", () => {
    const list = [s(5, 2), s(-3, -8), s(1, 4, { played: "2026-09-30", calls: 0, hits: 0 })];
    expect(won(list[0])).toBe(true);
    const sum = summarize(list, "2026-10-24");
    expect(sum).toMatchObject({ count: 3, thisMonth: 2, wins: 2, winPct: 67, hitPct: 50 });
    expect(sum.avgMine).toBeCloseTo(1);
    expect(summarize([], "2026-10-24").hitPct).toBeNull();
  });

  it("filters by blind and market", () => {
    const list = [s(1, 0), s(1, 0, { blind: false, ticker: "AAPL" }), s(1, 0, { ticker: "AAPL" })];
    expect(filterSessions(list, { kind: "pick", market: "all" })).toHaveLength(1);
    expect(filterSessions(list, { kind: "blind", market: "US" }).map((x) => x.ticker)).toEqual(["AAPL"]);
  });

  it("splits sessions only when both sides have enough and notes a big gap", () => {
    const up = [s(5, 10), s(6, 12), s(2, 8)]; // 오르는 차트: 다 짐
    const down = [s(-1, -6), s(0, -4), s(-2, -9)]; // 내리는 차트: 다 이김
    const out = habits([...up, ...down]);
    const chart = out.find((x) => x.title.startsWith("오르는"))!;
    expect(chart.a).toMatchObject({ n: 3, winPct: 0 });
    expect(chart.b).toMatchObject({ n: 3, winPct: 100 });
    expect(chart.note).toBe("내리는 차트에서 더 잘해요");
    expect(out.some((x) => x.title.startsWith("🎲"))).toBe(false); // 직접 고른 판이 없어요
  });

  it("finds habits worth saying", () => {
    const busy = [buy("2024-01-03"), sell("2024-01-10"), buy("2024-01-12"), sell("2024-02-01")];
    const list = [
      s(1, 9, { trades: busy }), s(2, 8, { trades: busy }), s(-1, 6, { trades: busy }),
      s(4, 3, { trades: [buy("2024-01-03")] }), s(-2, -5, { trades: [buy("2024-01-03")] }), s(0, -4, { trades: [] }),
    ];
    const lines = insights(list);
    expect(lines).toContain("매매를 4번 이상 한 판은 0%만 이겼어요. 3번 이하는 100%예요.");
    expect(lines.some((l) => l.startsWith("오르는 차트에서는 들고만 있기보다 평균"))).toBe(true);
    expect(lines).toContain("판 뒤 일주일 안에 다시 산 게 3번이에요.");
  });
});
