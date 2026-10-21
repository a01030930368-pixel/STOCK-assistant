import { describe, expect, it } from "vitest";
import { healthCheck, money, previousKey, tableOf, type StatementRow } from "./statements";

const r = (kind: "Y" | "Q" | "C", period: string, item: string, value: number): StatementRow => ({ kind, period, item, value });
const T = 1e12;
const rows: StatementRow[] = [
  ...[["2022", 40], ["2023", 32.8], ["2024", 66.2], ["2025", 88.4]].map(([p, v]) => r("Y", p as string, "revenue", (v as number) * T)),
  r("Y", "2024", "operating_income", 23.5 * T), r("Y", "2025", "operating_income", 37.6 * T),
  r("Y", "2025", "net_income", 30 * T), r("Y", "2025", "cfo", 42.7 * T), r("Y", "2025", "fcf", 15.3 * T),
  r("Y", "2025", "liabilities", 48 * T), r("Y", "2025", "equity", 94 * T),
  r("Q", "2025Q3", "revenue", 24.4 * T), r("Q", "2026Q3", "revenue", 29.1 * T),
  r("Q", "2026Q3", "liabilities", 51 * T), r("Q", "2026Q3", "equity", 107 * T),
  r("C", "2026Q3", "revenue", 79.1 * T),
];

describe("statements", () => {
  it("builds annual and quarterly columns", () => {
    const y = tableOf(rows, "Y");
    expect(y.columns.map((c) => c.label)).toEqual(["2023", "2024", "2025", "2026.3Q 누적"]);
    expect(y.get("Y:2025", "revenue")).toBe(88.4 * T);
    expect(tableOf(rows, "Q").columns.map((c) => c.label)).toEqual(["25.3Q", "26.3Q"]);
    expect(previousKey("Q:2026Q3")).toBe("Q:2025Q3");
    expect(previousKey("Y:2025")).toBe("Y:2024");
  });

  it("formats money in 조/억 and $B/$M", () => {
    expect(money(88.4 * T, "KR")).toBe("88.4조");
    expect(money(-3.2e10, "KR")).toBe("−320억");
    expect(money(1.23e10, "US")).toBe("$12.3B");
    expect(money(4.5e7, "US")).toBe("$45M");
  });

  it("gives five traffic lights from the numbers", () => {
    const c = healthCheck(rows, "KR");
    expect(c.map((x) => [x.title, x.light])).toEqual([["돈 버는 힘", "good"], ["빚", "good"], ["현금", "good"], ["성장", "good"], ["이익의 질", "good"]]);
    expect(c[0].text).toBe("2025년 영업이익률 43%, 1년 전 35%예요.");
    expect(c[1].text).toContain("26.3Q 말 부채비율 48%");
    expect(c[2].text).toBe("2025년 번 현금으로 설비투자를 하고도 15.3조가 남았어요.");
    expect(c[3].text).toBe("26.3Q 매출이 1년 전 같은 분기보다 +19% 변했어요.");
  });

  it("warns on losses and negative equity", () => {
    const bad = [r("Y", "2025", "revenue", 100), r("Y", "2025", "operating_income", -20), r("Y", "2025", "net_income", -30), r("Y", "2025", "cfo", 5),
      r("Y", "2025", "liabilities", 200), r("Y", "2025", "equity", -10), r("Y", "2025", "fcf", -40)];
    expect(healthCheck(bad, "KR").map((x) => x.light)).toEqual(["bad", "bad", "bad", "bad"]);
    expect(healthCheck([], "KR")).toEqual([]);
  });
});
