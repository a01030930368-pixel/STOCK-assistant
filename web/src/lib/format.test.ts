import { describe, expect, it } from "vitest";
import { asOf, fixedPct } from "./format";

describe("fixedPct", () => {
  it("keeps two decimals so 3 and 3.25 look alike", () => {
    expect(fixedPct("3")).toBe("3.00%");
    expect(fixedPct(-1)).toBe("-1.00%");
    expect(fixedPct(null)).toBe("-");
  });
});

describe("asOf", () => {
  it("formats monthly, daily and dashed dates the same way", () => {
    expect(asOf("202609")).toBe("2026.09");
    expect(asOf("20261019")).toBe("2026.10.19");
    expect(asOf("2026-10-18")).toBe("2026.10.18");
  });
});
