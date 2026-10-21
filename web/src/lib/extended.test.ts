import { describe, expect, it } from "vitest";
import { extPct, extWon, liveQuotes, nySession } from "./extended";

describe("extended hours", () => {
  it("knows the New York session", () => {
    expect(nySession(new Date("2026-10-21T09:00:00Z"))).toBe("pre"); // 05:00 NY (서머타임)
    expect(nySession(new Date("2026-10-21T15:00:00Z"))).toBe(null);
    expect(nySession(new Date("2026-10-21T21:00:00Z"))).toBe("post");
    expect(nySession(new Date("2026-11-10T08:59:00Z"))).toBe(null); // 겨울(UTC-5) 03:59 NY
    expect(nySession(new Date("2026-11-10T09:00:00Z"))).toBe("pre"); // 04:00 NY
    expect(nySession(new Date("2026-10-24T21:00:00Z"))).toBe(null); // 토요일
  });
  it("keeps only fresh quotes of this session", () => {
    const now = new Date("2026-10-21T21:00:00Z");
    const rows = [
      { ticker: "A", session: "post" as const, price: 11, base: 10, fetched_at: new Date("2026-10-21T20:55:00Z") },
      { ticker: "B", session: "pre" as const, price: 11, base: 10, fetched_at: new Date("2026-10-21T20:55:00Z") },
      { ticker: "C", session: "post" as const, price: 11, base: 10, fetched_at: new Date("2026-10-21T20:00:00Z") },
    ];
    expect([...liveQuotes(rows, now).keys()]).toEqual(["A"]);
    expect(extPct({ price: 11, base: 10 })).toBeCloseTo(10);
    expect(extWon({ price: 11, base: 10 }, 3, 1300)).toBe(3900);
    expect(extWon({ price: 11, base: 10 }, 3, 0)).toBe(null);
  });
});
