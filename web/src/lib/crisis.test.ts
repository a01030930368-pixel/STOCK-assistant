import { describe, expect, it } from "vitest";
import { beta, manwon, replay, scenarioOf, SCENARIOS, shock, WINDOWS, type Close, type CrisisHolding } from "./crisis";

const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

describe("beta", () => {
  it("2배로 움직이면 2", () => {
    const idx: Close[] = [], st: Close[] = [];
    let m = 100, s = 100;
    for (let i = 0; i < 100; i++) {
      const r = ((i * 7) % 5 - 2) / 100;
      m *= 1 + r; s *= 1 + 2 * r;
      idx.push({ day: day(i), close: m }); st.push({ day: day(i), close: s });
    }
    expect(beta(st, idx)).toBe(2);
  });
  it("자료가 모자라면 null", () => {
    expect(beta([{ day: day(0), close: 1 }], [{ day: day(0), close: 1 }])).toBeNull();
  });
});

const H = (o: Partial<CrisisHolding>): CrisisHolding => ({
  ticker: "A", name: "A", account: "KR", price: 100, value: 1_000_000, semi: false, stop: null, beta: 1, betaKnown: true, ...o,
});

describe("shock", () => {
  it("코스피 −20%에 베타 1.5면 −30%, 손절가 닿음", () => {
    const r = shock([H({ beta: 1.5, stop: 75 }), H({ ticker: "B", account: "US", value: 1_400_000, usd: 1000, price: 10 })], { krw: 600_000, usd: 0 }, 1400, SCENARIOS[0]);
    expect(r.rows.find((x) => x.ticker === "A")!.change).toBeCloseTo(-300_000);
    expect(r.rows.find((x) => x.ticker === "B")!.change).toBeCloseTo(0);
    expect(r.hits.map((x) => x.ticker)).toEqual(["A"]);
    expect(r.change).toBeCloseTo(-300_000);
    expect(r.cashBefore).toBeCloseTo(20);
  });
  it("환율 1,500원이면 미국 종목과 달러가 올라요", () => {
    const r = shock([H({ account: "US", value: 1_400_000, usd: 1000, price: 10 })], { krw: 0, usd: 100 }, 1400, SCENARIOS[2]);
    expect(r.byAccount.usFx).toBeCloseTo(100_000);
    expect(r.byAccount.cashFx).toBeCloseTo(10_000);
    expect(r.change).toBeCloseTo(110_000);
  });
  it("반도체 −25%는 반도체 종목만", () => {
    const r = shock([H({ semi: true }), H({ ticker: "B" })], { krw: 0, usd: 0 }, 1400, SCENARIOS[3]);
    expect(r.rows.map((x) => Math.round(x.change))).toEqual([-250_000, 0]);
  });
});

describe("replay", () => {
  const w = WINDOWS[0];
  const k: Close[] = [
    { day: "2020-02-14", close: 100 }, { day: "2020-02-17", close: 95 }, { day: "2020-03-19", close: 60 },
    { day: "2020-05-15", close: 90 }, { day: "2020-06-15", close: 101 },
  ];
  it("내 종목 실제 가격, 회복, 손절", () => {
    const own: Close[] = [{ day: "2020-02-14", close: 50 }, { day: "2020-03-19", close: 25 }, { day: "2020-05-15", close: 45 }, { day: "2020-06-15", close: 50 }];
    const r = replay([H({ ticker: "X", price: 200, value: 1_000_000, stop: 170 })], { krw: 0, usd: 0 }, 1400, new Map([["KOSPI", k], ["X", own]]), w)!;
    expect(r.points.map((p) => p.day)).toEqual(["2020-02-14", "2020-02-17", "2020-03-19", "2020-05-15"]);
    expect(r.troughPct).toBeCloseTo(-50);
    expect(r.troughDay).toBe("2020-03-19");
    expect(r.recoverDays).toBe(122); // 02-14 → 06-15
    expect(r.kospiRecoverDays).toBe(122);
    expect(r.hits.map((h) => h.day)).toEqual(["2020-03-19"]);
    expect(r.heldEndPct).toBeCloseTo(-10);
    expect(r.soldEndPct).toBeCloseTo(-50); // 갭 하락으로 그날 값(−50%)에 팔림
    expect(r.proxies).toEqual([]);
  });
  it("그때 없던 종목은 지수×베타", () => {
    const r = replay([H({ ticker: "Y", name: "새 종목", beta: 2 })], { krw: 1_000_000, usd: 0 }, 1400, new Map([["KOSPI", k]]), w)!;
    expect(r.proxies).toEqual(["새 종목"]);
    expect(r.troughPct).toBeCloseTo(-40); // 종목 −80% × 절반
  });
  it("코스피 자료가 없으면 null", () => {
    expect(replay([H({})], { krw: 0, usd: 0 }, 1400, new Map(), w)).toBeNull();
  });
});

it("글자", () => {
  expect(manwon(-12_400_000)).toBe("−1,240만 원");
  expect(manwon(3200)).toBe("+3,200원");
  expect(scenarioOf("covid").label).toBe("2020년 3월 코로나");
  expect(scenarioOf("zzz").id).toBe("kospi20");
});
