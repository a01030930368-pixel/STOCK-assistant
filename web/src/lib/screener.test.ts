import { describe as group, expect, it } from "vitest";
import { describe, matches, reasons, rulesFromForm, screen, type ScreenStock } from "./screener";

const s = (o: Partial<ScreenStock> = {}): ScreenStock => ({
  ticker: "000660", name: "SK하이닉스", price: 198400, changePct: 3.2, tradeValue: 1.234e12, volumeRatio: 2.4,
  rsi14: 58, ma20GapPct: 6.1, goldenCross: false, nearHighPct: -1.2, spark: [], ...o,
});

group("screener", () => {
  it("matches the trading value preset", () => {
    const r = { minValueEok: 1500, volRatioMin: 1.5, chgMin: -5, chgMax: 10 };
    expect(matches(s(), r)).toBe(true);
    expect(matches(s({ tradeValue: 1e11 }), r)).toBe(false);
    expect(matches(s({ changePct: 12 }), r)).toBe(false);
    expect(reasons(s(), r)).toEqual(["거래대금", "등락률", "거래량 2.4배"]);
  });

  it("treats missing indicators as not matching and empty rules as nothing", () => {
    expect(matches(s({ rsi14: null }), { rsiMax: 35 })).toBe(false);
    expect(matches(s(), {})).toBe(false);
  });

  it("checks ma20 side, golden cross and 52-week high", () => {
    expect(matches(s({ rsi14: 30, ma20GapPct: -4 }), { rsiMax: 35, ma20: "below" })).toBe(true);
    expect(matches(s(), { goldenCross: true })).toBe(false);
    expect(reasons(s({ nearHighPct: 0 }), { nearHighPct: 5 })).toEqual(["52주 신고가"]);
    expect(matches(s({ nearHighPct: -7 }), { nearHighPct: 5 })).toBe(false);
  });

  it("sorts results by trading value", () => {
    const out = screen([s({ ticker: "a", tradeValue: 1 }), s({ ticker: "b", tradeValue: 3 })], { rsiMax: 70 });
    expect(out.map((x) => x.ticker)).toEqual(["b", "a"]);
  });

  it("describes rules in Korean", () => {
    expect(describe({ minValueEok: 1500, volRatioMin: 1.5, chgMin: -5, chgMax: 10 })).toBe("거래대금 1,500억↑ · 등락률 -5~10% · 거래량 1.5배↑");
    expect(describe({ rsiMax: 35, ma20: "below" })).toBe("RSI 35↓ · 20일선 아래");
    expect(describe({})).toBe("조건 없음");
  });

  it("reads rules from a form and drops blanks", () => {
    const form: Record<string, string> = { minValueEok: "1,500", rsiMax: "", ma20: "above", goldenCross: "on", chgMin: "abc" };
    expect(rulesFromForm((k) => form[k] ?? "")).toEqual({ minValueEok: 1500, ma20: "above", goldenCross: true });
  });
});
