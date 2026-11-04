import { describe as group, expect, it } from "vitest";
import { binIsLoss, binLabels, chartWindow, cleanRule, closestRule, describe, edge, filterTrades, sortDuel, type LabRule, type Result, type Trade } from "./lab";

const res = (o: Partial<Result>): Result => ({ n: 10, wins: 5, winPct: 50, avg: 1, worst: -10, best: 10, avgDays: 5, hold: 0.5, avgWin: 3, avgLoss: -2, hist: [], bins: [], ...o });
const lr = (id: number, r: Partial<Result> | null): LabRule => ({ id, name: `r${id}`, rule: cleanRule({ buy: { ma20: true }, sell: { stop: 5 } }).rule, status: "done", error: null, result: r ? res(r) : null, doneAt: null });

group("cleanRule", () => {
  it("keeps only known fields and clamps", () => {
    const { rule, errors } = cleanRule({ buy: { ma20: 1, x: true }, sell: { stop: "7", target: -1, days: 3.6 }, market: "JP", years: 2 });
    expect(errors).toEqual([]);
    expect(rule.buy).toEqual({ ma20: true, rsi30: false, high52: false, vol2: false, support: false });
    expect(rule.sell).toEqual({ stop: 7, target: null, days: 4, ma20break: false });
    expect(rule.market).toBe("ALL");
    expect(rule.years).toBe(5);
  });
  it("needs buy and sell", () => {
    expect(cleanRule({}).errors).toHaveLength(2);
  });
});

group("describe / edge", () => {
  it("writes chips", () => {
    const { rule } = cleanRule({ buy: { rsi30: true, ma20: true }, sell: { stop: 7, target: 15, ma20break: true } });
    expect(describe(rule)).toEqual({ buy: ["20일선 위", "RSI 30 아래"], sell: ["손절 −7%", "익절 +15%", "20일선 이탈"] });
    expect(edge(res({ avg: 2.1, hold: 1.4 }))).toBe(0.7);
  });
});

group("sortDuel / closestRule", () => {
  const rules = [lr(1, { avg: 2.1, winPct: 54, worst: -18 }), lr(2, { avg: 3.4, winPct: 41, worst: -21 }), lr(3, null), lr(4, { avg: 0.6, winPct: 47, worst: -15 })];
  it("sorts by chosen metric, empty last", () => {
    expect(sortDuel(rules, "avg").map((x) => x.id)).toEqual([2, 1, 4, 3]);
    expect(sortDuel(rules, "win").map((x) => x.id)).toEqual([1, 4, 2, 3]);
    expect(sortDuel(rules, "safe").map((x) => x.id)).toEqual([4, 1, 2, 3]);
  });
  it("finds the rule most like my trades", () => {
    expect(closestRule(rules, { winRate: 52, avgReturn: 1.9 })?.id).toBe(1);
    expect(closestRule(rules, { winRate: null, avgReturn: 1 })).toBeNull();
  });
});

group("trades", () => {
  const t = (r: number): Trade => ({ t: "A", n: "a", m: "KR", b: "2024-01-01", s: "2024-01-05", bp: 1, sp: 1, r, d: 3, why: "", hold: 0 });
  it("filters", () => {
    const xs = [t(5), t(-3), t(-15), t(-12)];
    expect(filterTrades(xs, "win")).toHaveLength(1);
    expect(filterTrades(xs, "loss")).toHaveLength(3);
    expect(filterTrades(xs, "big").map((x) => x.r)).toEqual([-15, -12]);
  });
  it("chart window", () => {
    const days = Array.from({ length: 200 }, (_, i) => `d${String(i).padStart(3, "0")}`);
    expect(chartWindow(days, "d100", "d110")).toEqual([40, 141]);
    expect(chartWindow(days, "d010", "d199")).toEqual([0, 200]);
  });
});

group("bins", () => {
  it("labels and colors", () => {
    const bins = [-5, 0, 5];
    expect(binLabels(bins)).toEqual(["−5% 아래", "−5~0%", "0~+5%", "+5% 넘게"]);
    expect([0, 1, 2, 3].map((k) => binIsLoss(bins, k))).toEqual([true, true, false, false]);
  });
});
