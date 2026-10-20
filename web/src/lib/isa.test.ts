import { describe, expect, it } from "vitest";
import { maturity, settingsOf, taxFree, yearPct } from "./isa";

describe("isa", () => {
  it("reads saved settings safely", () => {
    expect(settingsOf({ type: "low", opened: "2025-03-10" })).toEqual({ type: "low", opened: "2025-03-10" });
    expect(settingsOf(null)).toEqual({ type: "general", opened: null });
    expect(settingsOf({ type: "x", opened: "3월" })).toEqual({ type: "general", opened: null });
  });
  it("counts days to the 3-year date", () => {
    expect(maturity("2025-03-10", "2026-10-20")).toEqual({ day: "2028-03-10", daysLeft: 507 });
    expect(maturity("2020-01-01", "2026-10-20").daysLeft).toBe(0);
  });
  it("compares gain with the tax-free limit", () => {
    expect(taxFree(356_600, "general")).toMatchObject({ limit: 2_000_000, over: 0 });
    expect(taxFree(356_600, "general").pct).toBeCloseTo(17.83, 1);
    expect(taxFree(5_000_000, "low")).toMatchObject({ pct: 100, over: 1_000_000 });
    expect(taxFree(-10, "general").gain).toBe(0);
  });
  it("caps the yearly bar", () => {
    expect(yearPct(6_000_000)).toBe(30);
    expect(yearPct(30_000_000)).toBe(100);
  });
});
