// 기업 공부 › 가설 탭: 확인 기준·날짜가 있는 내 생각(가설), 그 근거, 실적 날 점검, 지난 실적 발표 기록.
// 근거는 워커(worker/app/thesis.py)가 실적·공시·뉴스에서 붙이고, 숫자로 적은 가설은 분기 숫자로 맞춰 봐요. 판정은 사용자가 정해요.
import { change, margin, surprise, type Line, type Report } from "./earnings";
import { quarterLabel } from "./statements";
import type { Fields } from "./study";

export type Status = "watch" | "ok" | "bad" | "right" | "wrong";
export const STATUSES: Status[] = ["ok", "watch", "bad", "right", "wrong"];
export const OPEN: Status[] = ["watch", "ok", "bad"];
export const STATUS_WORD: Record<Status, string> = { watch: "지켜보는 중", ok: "맞아 가는 중", bad: "흔들림", right: "맞음", wrong: "틀림" };
export const isOpen = (s: Status) => OPEN.includes(s);

export const METRICS = {
  opm: "영업이익률", gpm: "매출총이익률", npm: "순이익률",
  rev_yoy: "매출 성장률(1년 전 같은 분기 대비)", op_yoy: "영업이익 성장률(1년 전 같은 분기 대비)", debt: "부채비율",
} as const;
export type Metric = keyof typeof METRICS;
export const isMetric = (m: unknown): m is Metric => typeof m === "string" && m in METRICS;

export type Evidence = { id: number; day: string; kind: string; text: string; url: string; sign: "up" | "down" | "neutral"; value: number | null; ref: string };
export type Suggestion = { status: "ok" | "bad" | "watch"; why: string; by: "ai" | "metric"; at: string; period?: string };
export type Thesis = {
  id: number; title: string; rule: string; dueOn: string | null; metric: Metric | null; op: ">=" | "<=" | null; target: number | null;
  status: Status; source: string; ai: Suggestion | null; createdAt: string; decidedAt: string | null; scanned: boolean; evidence: Evidence[];
};

// ---------------------------------------------------------------- 입력 정리

export type ThesisInput = { title: string; rule: string; dueOn: string | null; metric: Metric | null; op: ">=" | "<=" | null; target: number | null; source: string };
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export function cleanThesis(raw: Record<string, string>): ThesisInput | { error: string } {
  const title = (raw.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return { error: "가설 문장을 적어 주세요." };
  const metric = isMetric(raw.metric) ? raw.metric : null;
  const op = raw.op === "<=" ? "<=" : raw.op === ">=" ? ">=" : null;
  const target = raw.target?.trim() ? Number(raw.target.replace(/[,%\s]/g, "")) : null;
  if (metric && (op === null || target === null || !Number.isFinite(target) || Math.abs(target) > 10000)) return { error: "숫자 기준(이상·이하와 %)을 적어 주세요." };
  const dueOn = raw.dueOn && isDay(raw.dueOn) ? raw.dueOn : null;
  return {
    title, rule: (raw.rule ?? "").replace(/\s+/g, " ").trim().slice(0, 300), dueOn,
    metric, op: metric ? op : null, target: metric ? target : null, source: ["risk", "promise", "event"].includes(raw.source) ? raw.source : "self",
  };
}

// 숫자 가설의 확인 기준 글
export const metricRule = (t: Pick<Thesis, "metric" | "op" | "target">) =>
  t.metric && t.op && t.target !== null ? `${METRICS[t.metric]} ${t.target}% ${t.op === ">=" ? "이상" : "이하"} (분기 숫자로 앱이 확인)` : "";

// ---------------------------------------------------------------- 보드

export function counts(theses: Pick<Thesis, "status">[]) {
  const c = { open: 0, watch: 0, ok: 0, bad: 0, right: 0, wrong: 0 };
  for (const t of theses) { c[t.status]++; if (isOpen(t.status)) c.open++; }
  return c;
}

// 흔들림 → 맞아 가는 중 → 지켜보는 중 → 끝난 것(최근 판정 먼저)
const ORDER: Record<Status, number> = { bad: 0, ok: 1, watch: 2, right: 3, wrong: 3 };
export function sortTheses<T extends Pick<Thesis, "status" | "id" | "decidedAt">>(theses: T[]): T[] {
  return [...theses].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "") || a.id - b.id);
}

// AI·숫자가 지금 판정과 다른 걸 제안하고 있나(열린 가설만)
export const pendingSuggestion = (t: Pick<Thesis, "status" | "ai">) =>
  Boolean(t.ai && isOpen(t.status) && t.ai.status !== t.status && !(t.ai.status === "watch" && t.status === "watch"));

// 숫자 가설 막대: 최근 값이 기준보다 얼마나 넘었나. 0~100 사이 위치.
export function meter(t: Pick<Thesis, "metric" | "op" | "target" | "evidence">): { now: number; fill: number; mark: number; ok: boolean } | null {
  if (!t.metric || t.target === null || !t.op) return null;
  const last = t.evidence.filter((e) => e.kind === "metric" && e.value !== null).sort((a, b) => a.ref.localeCompare(b.ref)).at(-1);
  if (!last || last.value === null) return null;
  const now = last.value, target = t.target;
  const lo = Math.min(0, now, target), hi = Math.max(now, target, 0) * 1.25 || 1;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return { now, fill: pos(now), mark: pos(target), ok: t.op === ">=" ? now >= target : now <= target };
}

// 노트에서 바로 가설 만들기: ⑦ 틀릴 이유, ⑤ 경영진 약속, ⑥ 앞으로 일어날 일
export type Seed = { key: string; label: string; input: Partial<ThesisInput> & { title: string } };
export function seeds(f: Pick<Fields, "risks" | "promises" | "events">, existing: string[]): Seed[] {
  const have = new Set(existing.map((t) => t.replace(/\s/g, "")));
  const out: Seed[] = [];
  f.risks.forEach((r, i) => r.text && out.push({
    key: `risk${i}`, label: `⑦ ${r.text}`,
    input: { title: `이 일은 안 일어난다: ${r.text}`, rule: r.signal ? `이게 보이면 틀림: ${r.signal}` : "", source: "risk" },
  }));
  f.promises.forEach((p, i) => p.said && p.result === "wait" && out.push({
    key: `promise${i}`, label: `⑤ "${p.said}"`,
    input: { title: `경영진 말대로 된다: ${p.said}`, rule: p.when ? `${p.when}에 한 말` : "", source: "promise" },
  }));
  f.events.forEach((e, i) => e.text && out.push({
    key: `event${i}`, label: `⑥ ${e.text}`, input: { title: `${e.text}`, rule: "", dueOn: e.day || null, source: "event" },
  }));
  return out.filter((s) => !have.has(s.input.title.replace(/\s/g, "")));
}

// 다가오는 확인 날: 가설 기한 + 실적 발표 일정
export type Upcoming = { day: string; text: string; tag: string; tone: "" | "g" | "no" };
export function upcoming(theses: Thesis[], events: { day: string; title: string; kind: string }[], today: string): Upcoming[] {
  const out: Upcoming[] = theses.filter((t) => isOpen(t.status) && t.dueOn).map((t) => ({
    day: t.dueOn!, text: t.title, tag: t.dueOn! <= today ? "기한 지남" : "기한", tone: t.dueOn! <= today ? "no" : "",
  }));
  for (const e of events) if (e.day >= today) out.push({ day: e.day, text: e.title, tag: e.kind === "earnings" ? "실적 발표" : "일정", tone: e.kind === "earnings" ? "g" : "" });
  return out.sort((a, b) => a.day.localeCompare(b.day)).slice(0, 8);
}

// ---------------------------------------------------------------- 실적 날 점검

export type ReviewItem = { thesis: number; title: string; before: string; now: string; ai: string; aiStatus: string; mine: Status };
export type Review = { id: string; period: string; day: string; memo: string; doneAt: string | null; items: ReviewItem[] };

const prevQuarter = (p: string) => { const y = Number(p.slice(0, 4)), q = Number(p.slice(5)); return q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`; };
const quarterWord = (p: string) => `${p.slice(2, 4)}년 ${p.slice(5)}분기`;
export const reviewTitle = (period: string) => `${quarterWord(period)} 실적`;

// 점검 표 한 줄: 숫자 가설은 지난 분기 → 이번 분기 값, 아니면 지난 판정 → 이번 실적에 붙은 근거
export function reviewRows(period: string, theses: Thesis[]): ReviewItem[] {
  return theses.filter((t) => isOpen(t.status)).map((t) => {
    const metricOf = (p: string) => t.evidence.find((e) => e.ref === `m:${p}`);
    const cur = metricOf(period), prev = metricOf(prevQuarter(period));
    const fmt = (e?: Evidence) => (e && e.value !== null ? `${e.value.toFixed(1)}%` : "-");
    const linked = t.evidence.filter((e) => e.kind !== "metric" && e.kind !== "memo").sort((a, b) => b.day.localeCompare(a.day))[0];
    return {
      thesis: t.id, title: t.title,
      before: t.metric ? fmt(prev) : STATUS_WORD[t.status],
      now: t.metric ? (cur ? fmt(cur) : "숫자 기다리는 중") : linked ? linked.text.split("\n")[0].slice(0, 80) : "관련 자료 아직 없음",
      ai: t.ai ? STATUS_WORD[t.ai.status] : "-", aiStatus: t.ai?.status ?? "",
      mine: t.ai && t.ai.status !== "watch" ? t.ai.status : t.status,
    };
  });
}

// ---------------------------------------------------------------- 지난 실적 발표 기록

export type Filing = { day: string; period: string; title: string; url: string; source: string };
export const Q_ITEMS = ["revenue", "gross_profit", "operating_income", "net_income", "cfo"] as const;
export type QItem = (typeof Q_ITEMS)[number];
export type Quarter = Partial<Record<QItem, number>>;

// 시장 예상치(워커 estimates.py). 미국은 Finnhub, 국내는 네이버 예상 칸을 발표 전까지 매일 적어 둔 값.
export type Estimate = {
  period: string; source: "finnhub" | "naver"; epsActual: number | null; epsEstimate: number | null;
  revenueActual: number | null; revenueEstimate: number | null; opEstimate: number | null; netEstimate: number | null;
  reportedOn: string | null; hour: string | null; asOf: string;
};
export type Close = { day: string; close: number };
type Tone = { text: string; tone: string } | null;
export type EstItem = { label: string; kind: "money" | "eps"; actual: number | null; estimate: number; pct: number | null };
export type DetailLine = { label: string; value: number | null; qoq: Tone; yoy: Tone };
export type MarginLine = { label: string; now: number | null; before: number | null; diff: number | null };
export type Reaction = { baseDay: string; base: number; next: { day: string; pct: number } | null; week: { day: string; pct: number } | null; when: string };

export type HistoryRow = {
  period: string; label: string; day: string | null; links: { label: string; url: string }[];
  revenue: number | null; op: number | null; net: number | null;
  revYoy: Tone; opYoy: Tone; opm: number | null;
  eps: { actual: number | null; estimate: number | null } | null; ai: string; review: Review | null;
  est: { source: Estimate["source"]; asOf: string; items: EstItem[] } | null;
  lines: DetailLine[]; margins: MarginLine[]; cashRatio: number | null;
  prelim: { label: string; prelim: number; final: number }[]; reaction: Reaction | null;
};

const SOURCE_LABEL: Record<string, string> = {
  dart_prelim: "잠정실적 공시", dart_report: "정기보고서", sec_8k: "실적 발표(8-K)", sec_10q: "10-Q", sec_10k: "연간 보고서",
};
const LINE_LABEL: Record<QItem, string> = { revenue: "매출", gross_profit: "매출총이익", operating_income: "영업이익", net_income: "순이익", cfo: "영업현금흐름" };

const yearBefore = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
const ratio = (a: number | null | undefined, b: number | null | undefined) => (a == null || !b ? null : (a / b) * 100);

// 발표 전 마지막 종가 → 반응한 첫 거래일 종가, 그리고 5거래일 뒤. 미국 개장 전(bmo) 발표는 그날이 첫 반응이에요.
export function reaction(closes: Close[], day: string | null, hour: string | null = null): Reaction | null {
  if (!day || closes.length < 2) return null;
  const sorted = [...closes].sort((a, b) => a.day.localeCompare(b.day));
  let i = -1;
  for (let k = 0; k < sorted.length && sorted[k].day < day; k++) i = k;
  if (i < 0) return null;
  const bmo = hour === "bmo";
  const first = sorted.findIndex((c) => (bmo ? c.day >= day : c.day > day));
  if (first < 0) return null;
  const base = sorted[i];
  const at = (k: number) => (k < sorted.length ? { day: sorted[k].day, pct: (sorted[k].close / base.close - 1) * 100 } : null);
  return { baseDay: base.day, base: base.close, next: at(first), week: at(first + 4), when: bmo ? "개장 전 발표" : hour === "amc" ? "장 마감 뒤 발표" : "" };
}

function estItems(e: Estimate, actual: { revenue: number | null; op: number | null; net: number | null; eps: number | null }): EstItem[] {
  const out: EstItem[] = [];
  const add = (label: string, kind: EstItem["kind"], a: number | null, est: number | null) => {
    if (est === null || (a === null && e.source === "naver")) return;
    out.push({ label, kind, actual: a, estimate: est, pct: surprise(a, est) });
  };
  add("매출", "money", actual.revenue ?? e.revenueActual, e.revenueEstimate);
  add("영업이익", "money", actual.op, e.opEstimate);
  add("순이익", "money", actual.net, e.netEstimate);
  add("EPS", "eps", e.epsActual ?? actual.eps, e.epsEstimate);
  return out;
}

// 분기마다 한 줄. 숫자는 실적 정리(잠정·발표) → 재무제표 순으로 찾아요. 오래된 기록까지 최근 것부터.
export function earningsHistory(
  filings: Filing[], reports: (Report & { id?: string })[], quarters: Record<string, Quarter>, reviews: Review[], limit = 12,
  extra: { estimates?: Estimate[]; closes?: Close[] } = {},
): HistoryRow[] {
  const ests = new Map((extra.estimates ?? []).map((e) => [e.period, e]));
  const periods = new Set<string>([...filings.map((f) => f.period), ...reports.map((r) => r.period), ...Object.keys(quarters)]);
  for (const e of ests.values()) if (e.reportedOn || e.epsActual !== null || e.revenueActual !== null) periods.add(e.period);
  const repOf = (p: string) => reports.filter((r) => r.period === p).sort((a, b) => b.reported_on.localeCompare(a.reported_on))[0];
  const lineOf = (p: string, k: QItem) => (repOf(p)?.data.lines as Record<string, Line | undefined> | undefined)?.[k];
  const value = (p: string, k: QItem): number | null => {
    const line = lineOf(p, k);
    return line?.cur ?? quarters[p]?.[k] ?? (k === "revenue" ? ests.get(p)?.revenueActual ?? null : null);
  };
  const rows: HistoryRow[] = [];
  for (const period of [...periods].sort().reverse()) {
    const rep = repOf(period), est = ests.get(period);
    const fs = filings.filter((f) => f.period === period).sort((a, b) => a.day.localeCompare(b.day));
    const qy = quarters[yearBefore(period)] ?? {};
    const yoyOf = (k: "revenue" | "operating_income") => rep?.data.lines[k]?.yoy ?? qy[k] ?? null;
    const revenue = value(period, "revenue"), op = value(period, "operating_income"), net = value(period, "net_income");
    if (revenue === null && op === null && !fs.length && !rep) continue;
    const links = fs.map((f) => ({ label: SOURCE_LABEL[f.source] ?? f.title, url: f.url }));
    if (rep?.url && !links.some((l) => l.url === rep.url)) links.unshift({ label: rep.data.preliminary ? "잠정실적 공시" : "실적 발표", url: rep.url });
    // 처음 발표된 날(잠정실적 → 정정·확정 보고서가 뒤에 와도 첫 날 기준)
    const firsts = [...reports.filter((r) => r.period === period).map((r) => r.reported_on), ...(est?.reportedOn ? [est.reportedOn] : []), ...fs.map((f) => f.day)].filter(Boolean).sort();
    const day = firsts[0] ?? null;
    const eps = rep?.data.eps ?? (est && est.epsActual !== null ? { actual: est.epsActual, estimate: est.epsEstimate } : null);

    const lines: DetailLine[] = Q_ITEMS.map((k) => {
      const v = value(period, k);
      const line = lineOf(period, k);
      return { label: LINE_LABEL[k], value: v, qoq: change(v, value(prevQuarter(period), k) ?? line?.prev), yoy: change(v, value(yearBefore(period), k) ?? line?.yoy) };
    }).filter((l) => l.value !== null);
    const marginOf = (p: string, k: QItem) => ratio(value(p, k), value(p, "revenue"));
    const margins: MarginLine[] = (["gross_profit", "operating_income", "net_income"] as const).map((k) => {
      const now = marginOf(period, k), before = marginOf(yearBefore(period), k);
      return { label: `${LINE_LABEL[k]}률`, now, before, diff: now !== null && before !== null ? now - before : null };
    }).filter((m) => m.now !== null);
    const cfo = value(period, "cfo");
    const prelim = rep?.data.preliminary ? (["revenue", "operating_income", "net_income"] as const).flatMap((k) => {
      const a = rep.data.lines[k]?.cur, b = quarters[period]?.[k];
      return a != null && b != null && Math.abs(a - b) > Math.abs(b) * 0.005 ? [{ label: LINE_LABEL[k], prelim: a, final: b }] : [];
    }) : [];

    rows.push({
      period, label: quarterLabel(period), day, links, revenue, op, net,
      revYoy: change(revenue, yoyOf("revenue")), opYoy: change(op, yoyOf("operating_income")),
      opm: rep ? margin(rep.data, "cur") : revenue && op !== null ? (op / revenue) * 100 : null,
      eps, ai: rep?.ai ?? "", review: reviews.find((r) => r.period === period) ?? null,
      est: est ? { source: est.source, asOf: est.asOf, items: estItems(est, { revenue, op, net, eps: eps?.actual ?? null }) } : null,
      lines, margins, cashRatio: cfo !== null && net && net > 0 ? cfo / net : null, prelim,
      reaction: reaction(extra.closes ?? [], day, est?.hour ?? null),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function quartersFrom(rows: { kind: string; period: string; item: string; value: number }[]): Record<string, Quarter> {
  const out: Record<string, Quarter> = {};
  const cost: Record<string, number> = {};
  for (const r of rows) {
    if (r.kind !== "Q") continue;
    if (r.item === "cost_of_sales") cost[r.period] = r.value;
    if (!(Q_ITEMS as readonly string[]).includes(r.item)) continue;
    (out[r.period] ??= {})[r.item as QItem] = r.value;
  }
  for (const [p, c] of Object.entries(cost)) {
    const q = out[p];
    if (q && q.gross_profit === undefined && q.revenue !== undefined) q.gross_profit = q.revenue - c;
  }
  return out;
}
