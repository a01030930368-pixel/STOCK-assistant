import { describe, expect, it } from "vitest";
import { ALL_PARTS, applyDraft, bars, cheapGap, groupBySector, NO_SECTOR, cleanFields, emptyFields, filled, numbersOf, pastSelf, peerLine, reviewDefault, splitOf, type Version } from "./study";
import type { StatementRow } from "./statements";

describe("study notes", () => {
  it("cleans input: drops blank rows, clamps, keeps three risk slots", () => {
    const f = cleanFields({
      one: "  메모리를 팔아요  ", lines: [{ name: "D램", pct: 72.4 }, { name: "", pct: 10 }, { name: "낸드", pct: 300 }],
      power: "엄청 강함", promises: [{ when: "2026.07", said: "HBM4 양산", result: "kept" }, { said: "", result: "x" }],
      events: [{ day: "2027-01-28", text: "실적" }, { day: "언젠가", text: "인증" }], risks: [{ text: "값 하락", signal: "" }],
      cheap: "220,000", pricey: -1, verdict: "hold", sources: [{ title: "보고서", url: "javascript:alert(1)" }],
    });
    expect(f.one).toBe("메모리를 팔아요");
    expect(f.lines).toEqual([{ name: "D램", pct: 72 }, { name: "낸드", pct: 100 }]);
    expect(f.power).toBe("");
    expect(f.promises).toEqual([{ when: "2026.07", said: "HBM4 양산", result: "kept" }]);
    expect(f.events).toEqual([{ day: "2027-01-28", text: "실적" }, { day: "", text: "인증" }]);
    expect(f.risks).toHaveLength(3);
    expect(f.cheap).toBe(220000);
    expect(f.pricey).toBeNull();
    expect(f.verdict).toBe("");
    expect(f.sources).toEqual([{ title: "보고서", url: "" }]);
    expect(cleanFields(null)).toEqual(emptyFields());
    expect(cleanFields({ one: "상품 : A\n고객 : B\n" }).one).toBe("상품 : A\n고객 : B");
  });

  it("counts filled questions", () => {
    const f = { ...emptyFields(), one: "메모리를 서버 회사에 팔아요", cheap: 1, conclusion: "기다린다", verdict: "wait" as const };
    expect(filled(f)).toBe(3);
  });

  it("builds numbers from yearly statements", () => {
    const rows: StatementRow[] = [];
    const add = (p: string, item: string, value: number, kind: StatementRow["kind"] = "Y") => rows.push({ kind, period: p, item, value });
    [["2022", 100, 20, 30], ["2023", 80, -10, 5], ["2024", 120, 30, 40], ["2025", 160, 56, 60]].forEach(([p, r, o, c]) => {
      add(p as string, "revenue", r as number); add(p as string, "operating_income", o as number); add(p as string, "cfo", c as number);
    });
    add("2025", "liabilities", 61); add("2025", "equity", 100);
    const n = numbersOf(rows)!;
    expect(n.years).toEqual(["2022", "2023", "2024", "2025"]);
    expect(n.margin).toBe(35);
    expect(n.debt).toBe(61);
    expect(n.together).toBe(true);
    expect(bars(n.op)).toEqual([36, -18, 54, 100]);
    expect(numbersOf([])).toBeNull();
  });

  it("compares peers on latest year, handling US FY periods", () => {
    const rows = [
      { ticker: "MU", period: "FY2025", revenue: "200", operating_income: "44", liabilities: "50", equity: "100" },
      { ticker: "MU", period: "FY2024", revenue: "160", operating_income: "10", liabilities: "40", equity: "90" },
    ];
    expect(peerLine("MU", "Micron", rows)).toEqual({ ticker: "MU", name: "Micron", margin: 22, growth: 25, debt: 50, ready: true });
    expect(peerLine("X", "x", rows).ready).toBe(false);
  });

  it("finds the past self at least 60 days back", () => {
    const v = (id: number, at: string, price: number): Version => ({ id, fields: { ...emptyFields(), verdict: "wait" }, confidence: 3, price, saved_at: at });
    const now = new Date("2026-10-22T03:00:00Z");
    const past = pastSelf([v(1, "2026-04-01T00:00:00Z", 150), v(2, "2026-07-20T00:00:00Z", 200), v(3, "2026-10-20T00:00:00Z", 230)], now, 236)!;
    expect(past.version.id).toBe(2);
    expect(past.months).toBe(3);
    expect(past.change).toBe(18);
    expect(pastSelf([v(1, "2026-10-22T01:00:00Z", 1)], now, 2)).toBeNull();
  });

  it("splits revenue and fills drafts only into blank fields", () => {
    expect(splitOf([{ name: "D램", pct: 72 }, { name: "낸드", pct: 25 }]).at(-1)).toEqual({ name: "기타", pct: 3, other: true });
    expect(splitOf([{ name: "a", pct: 150 }, { name: "b", pct: 50 }]).map((s) => s.pct)).toEqual([75, 25]);
    const f = { ...emptyFields(), one: "내가 쓴 한 줄" };
    const out = applyDraft(f, { one: "AI 한 줄", customers: "엔비디아", risks: [{ text: "값 하락", signal: "고정가" }] }, ["one", "model", "risks"]);
    expect(out.one).toBe("내가 쓴 한 줄");
    expect(out.customers).toBe("엔비디아");
    expect(out.risks).toHaveLength(3);
    expect(out.risks[0].text).toBe("값 하락");
  });

  it("fills every blank part from a full draft but leaves the verdict to me", () => {
    const f = { ...emptyFields(), moat: "내가 쓴 강점", cheap: 100 };
    const out = applyDraft(f, {
      sector: "반도체", styles: ["기술주", "아무거나"], numbersNote: "현금도 늘어요", moat: "AI 강점",
      promises: [{ when: "2026.07", said: "HBM4 양산" }], cheap: 90, pricey: 200, priceWhy: "PER", conclusion: "정리", sources: [{ title: "IR", url: "https://x.com" }],
    }, ALL_PARTS);
    expect(out.sector).toBe("반도체");
    expect(out.styles).toEqual(["기술주"]);
    expect(out.numbersNote).toBe("현금도 늘어요");
    expect(out.moat).toBe("내가 쓴 강점");
    expect(out.promises).toEqual([{ when: "2026.07", said: "HBM4 양산", result: "wait" }]);
    expect([out.cheap, out.pricey]).toEqual([100, null]);
    expect(out.conclusion).toBe("정리");
    expect(out.sources).toHaveLength(1);
    expect(out.verdict).toBe("");
    expect(applyDraft(emptyFields(), { promises: "실적 자료" }, ALL_PARTS).promises).toEqual([]);
    expect(cleanFields({ styles: ["가치주", "가치주", "x"] }).styles).toEqual(["가치주"]);
  });

  it("adds AI prices when I only have a reason without numbers", () => {
    const f = { ...emptyFields(), priceWhy: "확인 필요" };
    const out = applyDraft(f, { cheap: 7, pricey: 11, priceWhy: "PER 어림" }, ALL_PARTS);
    expect([out.cheap, out.pricey, out.priceWhy]).toEqual([7, 11, "확인 필요"]);
    expect(applyDraft(f, { priceWhy: "x" }, ALL_PARTS).priceWhy).toBe("확인 필요");
  });

  it("groups notes by sector, biggest first, unknown last", () => {
    const g = groupBySector([{ sector: "은행" }, { sector: "" }, { sector: "반도체" }, { sector: " 반도체 " }]);
    expect(g.map((x) => [x.sector, x.items.length])).toEqual([["반도체", 2], ["은행", 1], [NO_SECTOR, 1]]);
    expect(cheapGap(220000, 259500)).toBe(-15.2);
    expect(cheapGap(null, 100)).toBeNull();
  });

  it("puts the review date three months out", () => {
    expect(reviewDefault("2026-10-22")).toBe("2027-01-22");
  });
});
