import { describe, expect, it } from "vitest";
import { averagePrice, holdingDays, marketOf, remainingQuantity, returnPct, validateBuy, type BuyInput } from "./journal";

const valid: BuyInput = {
  tradeDate: "2026-10-19",
  ticker: "005930",
  name: "삼성전자",
  market: "KR",
  quantity: 10,
  price: 70000,
  reason: "HBM 점유율 회복이 내년 실적에 반영될 것이라 본다",
  scenario: "",
  risks: ["메모리 가격 하락", "환율", "경쟁사 증설"],
  weightPct: 10,
  stopPrice: 65000,
  targetPrice: 85000,
  targetBasis: "chart",
};

describe("validateBuy", () => {
  it("passes a complete checklist", () => {
    expect(validateBuy(valid)).toEqual([]);
  });

  it("requires every checklist item", () => {
    const errors = validateBuy({ ...valid, reason: " ", risks: ["a", "", "c"], weightPct: 0 });
    expect(errors).toHaveLength(3);
  });

  it("rejects a reason longer than one sentence", () => {
    expect(validateBuy({ ...valid, reason: "싸다. 그리고 좋다" })).toContain("1. 매수 이유는 한 문장이어야 합니다.");
  });

  it("checks stop below and target above the buy price", () => {
    const errors = validateBuy({ ...valid, stopPrice: 71000, targetPrice: 69000 });
    expect(errors).toEqual(["4. 손절 라인은 매수가보다 낮아야 합니다.", "5. 익절 목표가는 매수가보다 높아야 합니다."]);
  });
});

describe("sell calculations", () => {
  const buys = [
    { tradeDate: "2026-01-02", quantity: 10, price: 100 },
    { tradeDate: "2026-01-12", quantity: 10, price: 120 },
  ];

  it("uses the weighted average buy price", () => {
    expect(averagePrice(buys)).toBe(110);
    expect(returnPct(110, 121)).toBe(10);
  });

  it("counts holding days from the first buy", () => {
    expect(holdingDays(buys, "2026-01-31")).toBe(29);
  });

  it("tracks remaining quantity", () => {
    expect(remainingQuantity(buys, [{ tradeDate: "2026-02-01", quantity: 15, price: 130 }])).toBe(5);
  });
});

describe("marketOf", () => {
  it("reads the market from the ticker", () => {
    expect(marketOf("spym", "KR")).toBe("US");
    expect(marketOf("BRK.B", "KR")).toBe("US");
    expect(marketOf("005930", "US")).toBe("KR");
    expect(marketOf("Q500001", "US")).toBe("KR"); // 국내 ETN
    expect(marketOf("0001A0", "US")).toBe("KR");
    expect(marketOf("Q530036", "KR")).toBe("KR");
  });
});
