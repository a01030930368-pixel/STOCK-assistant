import { describe, expect, it } from "vitest";
import { monthGrid, monthOf, shift, ym } from "./calendar";

describe("monthGrid", () => {
  it("starts weeks on Sunday", () => {
    // 2026-10-01은 목요일
    const weeks = monthGrid({ year: 2026, month: 10 });
    expect(weeks[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe("month navigation", () => {
  it("wraps years", () => {
    expect(ym(shift({ year: 2026, month: 12 }, 1))).toBe("2027-01");
    expect(ym(shift({ year: 2026, month: 1 }, -1))).toBe("2025-12");
  });
  it("falls back to today's month", () => {
    expect(monthOf("2026-13", "2026-10-19")).toEqual({ year: 2026, month: 10 });
    expect(monthOf("2027-02", "2026-10-19")).toEqual({ year: 2027, month: 2 });
  });
});
