import { describe, expect, it } from "vitest";
import { cellColor, dailyChanges, monthCells, monthSummary, shiftMonth, shortWon } from "./daily";

const rows = [
  { day: "2026-09-30", total: 10_000_000 },
  { day: "2026-10-20", total: 10_200_000 },
  { day: "2026-10-21", total: 10_098_000 },
  { day: "2026-10-22", total: 10_400_940 },
];

describe("daily calendar", () => {
  it("compares each day with the previous record", () => {
    const c = dailyChanges(rows);
    expect(c.get("2026-09-30")?.change).toBeNull();
    expect([c.get("2026-10-21")?.change, c.get("2026-10-21")?.pct]).toEqual([-102_000, -1]);
    expect(c.get("2026-10-22")?.pct).toBe(3);
  });

  it("starts the month on Sunday and shifts months across years", () => {
    const cells = monthCells("2026-10");
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]); // 10월 1일은 목요일
    expect(cells.at(-1)).toBe("2026-10-31");
    expect([shiftMonth("2026-12", 1), shiftMonth("2026-01", -1)]).toEqual(["2027-01", "2025-12"]);
  });

  it("sums the month against last month's final record", () => {
    const c = dailyChanges(rows);
    expect(monthSummary(rows, c, "2026-10")).toEqual({ change: 400_940, pct: 4.01, ups: 2, downs: 1, from: null });
    const fresh = rows.slice(1);
    expect(monthSummary(fresh, dailyChanges(fresh), "2026-10")).toMatchObject({ change: 200_940, from: "2026-10-20" });
    expect(monthSummary(rows, c, "2026-08").change).toBeNull();
  });

  it("colors and shortens", () => {
    expect(cellColor(null)).toBeUndefined();
    expect(cellColor(5)).toBe("rgba(232, 128, 111, 0.76)");
    expect(cellColor(-1.25)).toBe("rgba(134, 168, 230, 0.45)");
    expect([shortWon(250_000), shortWon(-12_345_678), shortWon(8_500)]).toEqual(["+25만", "−1,235만", "+8,500"]);
  });
});
