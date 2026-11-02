import { describe, expect, it } from "vitest";
import { cleanThesis, counts, earningsHistory, meter, metricRule, pendingSuggestion, quartersFrom, reviewRows, seeds, sortTheses, upcoming, type Thesis } from "./thesis";
import type { Report } from "./earnings";

const base: Thesis = {
  id: 1, title: "t", rule: "", dueOn: null, metric: null, op: null, target: null, status: "watch", source: "self", ai: null,
  createdAt: "2026-10-01", decidedAt: null, scanned: true, evidence: [],
};
const ev = (ref: string, value: number | null, extra = {}) => ({ id: Math.random(), day: "2026-10-23", kind: "metric", text: ref, url: "", sign: "up" as const, value, ref, ...extra });

describe("cleanThesis", () => {
  it("needs a sentence and a full number rule", () => {
    expect(cleanThesis({ title: "  " })).toEqual({ error: "가설 문장을 적어 주세요." });
    expect(cleanThesis({ title: "이익률", metric: "opm", op: ">=", target: "" })).toHaveProperty("error");
    expect(cleanThesis({ title: "이익률 30%", metric: "opm", op: ">=", target: "30%" })).toMatchObject({ metric: "opm", op: ">=", target: 30 });
  });
  it("drops number fields for text theses and bad dates", () => {
    const t = cleanThesis({ title: "삼성은 인증을 못 받는다", rule: " 공급  뉴스 ", metric: "x", op: ">=", target: "5", dueOn: "2026-02-30", source: "risk" });
    expect(t).toEqual({ title: "삼성은 인증을 못 받는다", rule: "공급 뉴스", dueOn: null, metric: null, op: null, target: null, source: "risk" });
    expect(cleanThesis({ title: "a", dueOn: "2027-01-28" })).toMatchObject({ dueOn: "2027-01-28", source: "self" });
  });
});

describe("board", () => {
  const list: Thesis[] = [
    { ...base, id: 1, status: "watch" }, { ...base, id: 2, status: "bad" }, { ...base, id: 3, status: "right", decidedAt: "2026-10-01" },
    { ...base, id: 4, status: "ok" }, { ...base, id: 5, status: "wrong", decidedAt: "2026-10-20" },
  ];
  it("counts and sorts shaky ones first", () => {
    expect(counts(list)).toMatchObject({ open: 3, bad: 1, ok: 1, watch: 1, right: 1, wrong: 1 });
    expect(sortTheses(list).map((t) => t.id)).toEqual([2, 4, 1, 5, 3]);
  });
  it("suggestion is pending only when it differs on an open thesis", () => {
    const ai = { status: "bad" as const, why: "", by: "ai" as const, at: "" };
    expect(pendingSuggestion({ status: "watch", ai })).toBe(true);
    expect(pendingSuggestion({ status: "bad", ai })).toBe(false);
    expect(pendingSuggestion({ status: "right", ai })).toBe(false);
    expect(pendingSuggestion({ status: "watch", ai: { ...ai, status: "watch" } })).toBe(false);
  });
  it("meter uses the latest quarter", () => {
    const t = { ...base, metric: "opm" as const, op: ">=" as const, target: 30, evidence: [ev("m:2026Q2", 45), ev("m:2026Q3", 47)] };
    const m = meter(t)!;
    expect(m.now).toBe(47);
    expect(m.ok).toBe(true);
    expect(m.mark).toBeLessThan(m.fill);
    expect(meter({ ...t, evidence: [] })).toBeNull();
    expect(meter({ ...t, op: "<=" })!.ok).toBe(false);
    expect(metricRule(t)).toBe("영업이익률 30% 이상 (분기 숫자로 앱이 확인)");
  });
});

describe("seeds", () => {
  it("turns risks, waiting promises and events into thesis drafts, skipping ones already made", () => {
    const s = seeds({
      risks: [{ text: "메모리 값 하락", signal: "D램 고정가 2달 하락" }, { text: "", signal: "" }],
      promises: [{ when: "2026.10", said: "내년 HBM 완판", result: "wait" }, { when: "", said: "투자 축소", result: "broken" }],
      events: [{ day: "2027-01-28", text: "4분기 실적" }],
    }, ["4분기 실적"]);
    expect(s.map((x) => x.key)).toEqual(["risk0", "promise0"]);
    expect(s[0].input).toMatchObject({ title: "이 일은 안 일어난다: 메모리 값 하락", rule: "이게 보이면 틀림: D램 고정가 2달 하락", source: "risk" });
  });
});

describe("upcoming", () => {
  it("merges due dates and earnings days in order", () => {
    const u = upcoming([{ ...base, dueOn: "2026-11-01", title: "a" }, { ...base, id: 2, dueOn: "2027-02-01", title: "b", status: "right" }],
      [{ day: "2027-01-28", title: "4분기 실적 발표", kind: "earnings" }, { day: "2026-10-01", title: "old", kind: "earnings" }], "2026-11-02");
    expect(u.map((x) => [x.day, x.tag])).toEqual([["2026-11-01", "기한 지남"], ["2027-01-28", "실적 발표"]]);
  });
});

describe("reviewRows", () => {
  it("shows last and this quarter for number theses and the newest evidence otherwise", () => {
    const rows = reviewRows("2026Q3", [
      { ...base, id: 1, title: "이익률", metric: "opm", op: ">=", target: 30, evidence: [ev("m:2026Q2", 45), ev("m:2026Q3", 47)],
        ai: { status: "ok", why: "", by: "metric", at: "" } },
      { ...base, id: 2, title: "삼성", evidence: [ev("n:1", null, { kind: "news", text: "[뉴스] 퀄 통과\n→ 틀릴 수 있어요", day: "2026-10-29" })] },
      { ...base, id: 3, title: "끝", status: "right" },
    ]);
    expect(rows).toEqual([
      { thesis: 1, title: "이익률", before: "45.0%", now: "47.0%", ai: "맞아 가는 중", aiStatus: "ok", mine: "ok" },
      { thesis: 2, title: "삼성", before: "지켜보는 중", now: "[뉴스] 퀄 통과", ai: "-", aiStatus: "", mine: "watch" },
    ]);
  });
});

describe("earningsHistory", () => {
  const report = {
    period: "2026Q3", reported_on: "2026-10-23", url: "https://dart/1", market: "KR", ai: "HBM이 늘었어요",
    data: { unit: "KRW", lines: { revenue: { cur: 150, prev: 120, yoy: 100 }, operating_income: { cur: 60, prev: 40, yoy: 30 } }, eps: null, revenue_estimate: null, history: [], surprises: [], preliminary: true },
  } as Report;
  const q = quartersFrom([
    { kind: "Q", period: "2025Q3", item: "revenue", value: 100 }, { kind: "Q", period: "2025Q3", item: "operating_income", value: 30 },
    { kind: "Q", period: "2026Q2", item: "revenue", value: 120 }, { kind: "Q", period: "2025Q2", item: "revenue", value: 80 },
    { kind: "Y", period: "2025", item: "revenue", value: 999 }, { kind: "Q", period: "2026Q2", item: "cash", value: 5 },
  ]);
  it("lists every quarter newest first with links, numbers and past review", () => {
    const rows = earningsHistory(
      [{ day: "2026-10-23", period: "2026Q3", title: "잠정", url: "https://dart/1", source: "dart_prelim" }, { day: "2026-08-14", period: "2026Q2", title: "반기보고서", url: "https://dart/2", source: "dart_report" }],
      [report], q, [{ id: "x:2026Q2", period: "2026Q2", day: "2026-07-24", memo: "좋았다", doneAt: "2026-07-25", items: [] }],
    );
    expect(rows.map((r) => r.period)).toEqual(["2026Q3", "2026Q2", "2025Q3", "2025Q2"]);
    expect(rows[0]).toMatchObject({ day: "2026-10-23", revenue: 150, op: 60, opm: 40, ai: "HBM이 늘었어요", links: [{ label: "잠정실적 공시", url: "https://dart/1" }] });
    expect(rows[0].revYoy).toEqual({ text: "+50%", tone: "up" });
    expect(rows[1]).toMatchObject({ revenue: 120, op: null, links: [{ label: "정기보고서", url: "https://dart/2" }] });
    expect(rows[1].revYoy?.text).toBe("+50%");
    expect(rows[1].review?.memo).toBe("좋았다");
    expect(earningsHistory([], [report], q, [], 2)).toHaveLength(2);
  });
});
