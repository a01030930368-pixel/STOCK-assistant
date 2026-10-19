import { describe, expect, it } from "vitest";
import { optionalNumber, rateGap, validateMacro, type MacroInput } from "./macro";

const base: MacroInput = {
  snapshotDate: "2026-10-19", krBaseRate: 2.5, usBaseRate: 4.25, usdkrw: 1375.2, gdpOutlook: "",
  inflation: 2.1, usInflation: null, keyVariables: "", implications: "금리 인하 기대",
};

describe("macro", () => {
  it("parses optional numbers", () => {
    expect(optionalNumber("")).toBeNull();
    expect(optionalNumber("1,375.2")).toBe(1375.2);
    expect(optionalNumber("2.5%")).toBe(2.5);
    expect(Number.isNaN(optionalNumber("abc"))).toBe(true);
  });

  it("computes the KR-US rate gap", () => {
    expect(rateGap("2.50", "4.25")).toBe(-1.75);
    expect(rateGap(null, 4.25)).toBeNull();
  });

  it("requires a date and implications, and rejects non-numbers", () => {
    expect(validateMacro(base)).toEqual([]);
    expect(validateMacro({ ...base, snapshotDate: "", implications: " ", usdkrw: Number.NaN })).toEqual([
      "기록 날짜를 입력하세요.", "원/달러 환율은 숫자로 입력하세요.", "시사점을 한 줄이라도 적어 주세요.",
    ]);
  });
});
