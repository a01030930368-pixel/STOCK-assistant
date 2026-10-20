import { describe, expect, it } from "vitest";
import { lessons, summarizeReviews, type Reviewed } from "./reviews";

const r = (name: string, end: string, returnPct: number | null, stars: number | null, lesson = "교훈"): Reviewed => ({
  key: `KR:${name}:${end}`, name, end, returnPct, stars, followed: true, lesson,
});

describe("summarizeReviews", () => {
  it("averages returns by star rating", () => {
    const s = summarizeReviews([r("A", "2026-10-14", 35.5, 4), r("B", "2026-09-30", -14.6, 2), r("C", "2026-08-19", 22.7, 5),
      r("D", "2026-08-05", -11.8, 1), r("E", "2026-08-01", null, 4), r("F", "2026-07-01", 3, null)], 9);
    expect([s.closed, s.reviewed, s.avgStars]).toEqual([9, 6, 3.2]);
    expect(s.high).toEqual({ count: 3, avgReturn: 29.1 });
    expect(s.low).toEqual({ count: 2, avgReturn: -13.2 });
    expect(s.byStars.map((x) => [x.stars, x.count, x.avgReturn])).toEqual([[5, 1, 22.7], [4, 2, 35.5], [3, 0, null], [2, 1, -14.6], [1, 1, -11.8]]);
  });
  it("lists lessons newest first and skips empty ones", () => {
    expect(lessons([r("A", "2026-08-01", 1, 3), r("B", "2026-10-01", 1, 3), r("C", "2026-09-01", 1, 3, " ")]).map((x) => x.name)).toEqual(["B", "A"]);
  });
});
