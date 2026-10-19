import { describe, expect, it } from "vitest";
import { bigMoney, debtRatio, median, operatingMargin, type FinancialRow } from "./research";

const row = (over: Partial<FinancialRow>): FinancialRow => ({
  ticker: "X", period: "2025", revenue: "1000", operating_income: "123", liabilities: "300", equity: "200",
  operating_cash_flow: "50", ...over,
});

describe("research", () => {
  it("computes margins and debt ratio", () => {
    expect(operatingMargin(row({}))).toBe(12.3);
    expect(operatingMargin(row({ revenue: null }))).toBeNull();
    expect(debtRatio(row({}))).toBe(150);
    expect(debtRatio(row({ equity: "-5" }))).toBeNull();
  });

  it("takes the median ignoring missing values", () => {
    expect(median([10, null, 2, 6])).toBe(6);
    expect(median([10, 2, 6, 4])).toBe(5);
    expect(median([null])).toBeNull();
  });

  it("formats big amounts per market", () => {
    expect(bigMoney("300870000000000", "KR")).toBe("300.9조원");
    expect(bigMoney("-34000000000", "KR")).toBe("-340억원");
    expect(bigMoney("416161000000", "US")).toBe("$416.2B");
    expect(bigMoney(null, "US")).toBe("-");
  });
});
