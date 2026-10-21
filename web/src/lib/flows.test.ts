import { describe, expect, it } from "vitest";
import { cumulative, money, streak, streakText, total, type FlowRow } from "./flows";

const row = (day: string, f: number, i = 0, p = 0): FlowRow => ({ day, close: 100, foreign: f, institution: i, individual: p });

describe("flows", () => {
  const rows = [row("1", -50, 10), row("2", 30, -5), row("3", 20, -5), row("4", 82000, 3)];
  it("sums and accumulates", () => {
    expect(cumulative(rows, "foreign")).toEqual([-50, -20, 0, 82000]);
    expect(total(rows, "institution")).toBe(3);
  });
  it("counts streaks from the latest day", () => {
    expect(streak(rows, "foreign")).toBe(3);
    expect(streak(rows, "institution")).toBe(1);
    expect(streak([row("1", 5), row("2", -1), row("3", -2)], "foreign")).toBe(-2);
    expect(streakText(3)).toBe("3일 연속 순매수");
    expect(streakText(-2)).toBe("2일 연속 순매도");
    expect(streakText(0)).toBe("");
  });
  it("formats million won as 억/조", () => {
    expect(money(82000)).toBe("+820억");
    expect(money(-150)).toBe("−1.5억");
    expect(money(1_234_000)).toBe("+1.2조");
  });
});
