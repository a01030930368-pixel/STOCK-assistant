// 기업 공부 › 깊이 보기 탭: 재무제표(stock_statements)·주가·주식 수로 앱이 계산하는 숫자 분석.
// 국내는 원, 미국은 달러. 손익·현금흐름은 분기(석 달) 값, 재무상태는 그 분기 말 값이에요.
import { aggregate, type Candle } from "./candles";
import { perShare } from "./bands";
import type { StatementRow } from "./statements";

const prevQ = (p: string) => { const y = Number(p.slice(0, 4)), q = Number(p.slice(5)); return q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`; };
const yearAgo = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
const div = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : a / b);

export type QRow = { period: string; revenue: number | null; op: number | null; net: number | null; opm: number | null; cfo: number | null; capex: number | null; fcf: number | null };

function table(rows: StatementRow[], kind: "Q" | "Y") {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) if (r.kind === kind) { if (!m.has(r.period)) m.set(r.period, new Map()); m.get(r.period)!.set(r.item, r.value); }
  return m;
}

// 최근 12분기(오래된 것부터)
export function quarters(rows: StatementRow[], n = 12): QRow[] {
  const q = table(rows, "Q");
  return [...q.keys()].sort().slice(-n).map((p) => {
    const v = q.get(p)!, g = (k: string) => v.get(k) ?? null;
    const fcf = g("fcf") ?? (g("cfo") !== null && g("capex") !== null ? g("cfo")! - g("capex")! : null);
    return { period: p, revenue: g("revenue"), op: g("operating_income"), net: g("net_income"), opm: div(g("operating_income"), g("revenue")), cfo: g("cfo"), capex: g("capex"), fcf };
  }).map((r) => ({ ...r, opm: r.opm === null ? null : r.opm * 100 }));
}

// 최근 4분기 합(빠진 분기가 있으면 null)
export function ttm(rows: StatementRow[], item: string, end?: string): number | null {
  const q = table(rows, "Q");
  let p = end ?? [...q.keys()].sort().at(-1);
  if (!p) return null;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const v = q.get(p)?.get(item);
    if (v === undefined) return null;
    sum += v; p = prevQ(p);
  }
  return sum;
}

const stockAt = (rows: StatementRow[], item: string, period: string) => table(rows, "Q").get(period)?.get(item) ?? null;
const lastPeriod = (rows: StatementRow[]) => [...table(rows, "Q").keys()].sort().at(-1) ?? null;

export function growthLatest(rows: StatementRow[], item = "revenue"): number | null {
  const p = lastPeriod(rows);
  if (!p) return null;
  const cur = stockAt(rows, item, p), base = stockAt(rows, item, yearAgo(p));
  return cur === null || base === null || base <= 0 ? null : (cur / base - 1) * 100;
}

// ---------------------------------------------------------------- ROE 나눠 보기(듀퐁)

export type Dupont = { label: string; roe: number | null; margin: number | null; turnover: number | null; leverage: number | null };
function dupontOf(label: string, rev: number | null, ni: number | null, assets: number | null, equity: number | null): Dupont {
  const margin = div(ni, rev), turnover = div(rev, assets), leverage = div(assets, equity);
  const roe = margin !== null && turnover !== null && leverage !== null ? margin * turnover * leverage * 100 : null;
  return { label, roe, margin: margin === null ? null : margin * 100, turnover, leverage };
}

// 연간 최근 2년 + 최근 4분기. 자산·자본은 기초와 기말 평균.
export function dupont(rows: StatementRow[]): Dupont[] {
  const y = table(rows, "Y");
  const years = [...y.keys()].filter((k) => y.get(k)!.has("revenue") && y.get(k)!.has("net_income")).sort().slice(-2);
  const avg = (a: number | null | undefined, b: number | null | undefined) => (a == null ? b ?? null : b == null ? a : (a + b) / 2);
  const out = years.map((yr) => {
    const v = y.get(yr)!, pv = y.get(String(Number(yr) - 1));
    return dupontOf(yr, v.get("revenue") ?? null, v.get("net_income") ?? null, avg(v.get("assets"), pv?.get("assets")), avg(v.get("equity"), pv?.get("equity")));
  });
  const p = lastPeriod(rows);
  if (p) {
    out.push(dupontOf("최근 4분기", ttm(rows, "revenue"), ttm(rows, "net_income"),
      avg(stockAt(rows, "assets", p), stockAt(rows, "assets", yearAgo(p))), avg(stockAt(rows, "equity", p), stockAt(rows, "equity", yearAgo(p)))));
  }
  return out;
}

export function dupontSentence(d: Dupont[]): string {
  const now = d.at(-1), before = d.length > 1 ? d[0] : null;
  if (!now || now.roe === null) return "";
  if (now.leverage !== null && now.leverage >= 3) return "빚(레버리지)이 ROE를 크게 올리고 있어요. 이익이 줄면 ROE가 빠르게 떨어질 수 있어요.";
  if (before?.roe != null && before.margin != null && now.margin != null && now.roe > before.roe) {
    return now.margin > before.margin ? "ROE가 오른 건 주로 이익률이 좋아져서예요. 빚이 아니라 장사가 잘돼서 오른 질 좋은 ROE예요." : "ROE가 오른 건 이익률보다 자산 회전·빚 쪽 영향이 커요.";
  }
  return now.roe >= 15 ? "ROE가 15%를 넘어요. 자본을 효율적으로 쓰고 있어요." : now.roe < 5 ? "ROE가 5%보다 낮아요. 자본에 비해 버는 돈이 적어요." : "ROE는 보통 수준이에요.";
}

// ---------------------------------------------------------------- 현금·재무 안전

export type Safety = {
  debt: number | null; debtBefore: number | null; cashShare: number | null; equityGrowth: number | null; cashQuality: number | null;
  fcfTtm: number | null; fcfYield: number | null; capexShare: number | null;
};
export function safety(rows: StatementRow[], marketCap: number | null): Safety {
  const p = lastPeriod(rows);
  if (!p) return { debt: null, debtBefore: null, cashShare: null, equityGrowth: null, cashQuality: null, fcfTtm: null, fcfYield: null, capexShare: null };
  const pct = (v: number | null) => (v === null ? null : v * 100);
  const eq = stockAt(rows, "equity", p), eqY = stockAt(rows, "equity", yearAgo(p));
  const fcfTtm = ttm(rows, "fcf") ?? (ttm(rows, "cfo") !== null && ttm(rows, "capex") !== null ? ttm(rows, "cfo")! - ttm(rows, "capex")! : null);
  const ni = ttm(rows, "net_income");
  return {
    debt: eq && eq > 0 ? pct(div(stockAt(rows, "liabilities", p), eq)) : null,
    debtBefore: eqY && eqY > 0 ? pct(div(stockAt(rows, "liabilities", yearAgo(p)), eqY)) : null,
    cashShare: pct(div(stockAt(rows, "cash", p), stockAt(rows, "assets", p))),
    equityGrowth: eq !== null && eqY && eqY > 0 ? (eq / eqY - 1) * 100 : null,
    cashQuality: ni && ni > 0 ? div(ttm(rows, "cfo"), ni) : null,
    fcfTtm, fcfYield: marketCap && fcfTtm !== null ? (fcfTtm / marketCap) * 100 : null,
    capexShare: pct(div(ttm(rows, "capex"), ttm(rows, "revenue"))),
  };
}

// ---------------------------------------------------------------- PER 흐름(주봉)

export type PerBand = { points: { day: string; per: number }[]; current: number | null; avg: number; low: number; high: number; position: number | null };
export function perHistory(candles: Candle[], rows: StatementRow[], shares: number | null, price: number | null, years = 5): PerBand | null {
  if (!shares || !candles.length) return null;
  const eps = perShare(rows, shares, "per");
  if (!eps.length) return null;
  const from = new Date(Date.parse(candles.at(-1)!.day) - years * 365 * 86400000).toISOString().slice(0, 10);
  const bars = aggregate(candles.map((c) => ({ ...c })), "W").filter((b) => b.day >= from);
  let j = -1;
  const points: { day: string; per: number }[] = [];
  for (const b of bars) {
    while (j + 1 < eps.length && eps[j + 1].from <= b.day) j++;
    if (j >= 0 && eps[j].value > 0) points.push({ day: b.day, per: b.close / eps[j].value });
  }
  if (points.length < 8) return null;
  const sorted = points.map((p) => p.per).sort((a, b) => a - b);
  const q = (x: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * x)))];
  const lastEps = eps.at(-1)!.value;
  const current = lastEps > 0 && price ? price / lastEps : null;
  return {
    points, current, avg: sorted.reduce((a, b) => a + b, 0) / sorted.length, low: q(0.05), high: q(0.95),
    position: current === null ? null : Math.round((sorted.filter((v) => v <= current).length / sorted.length) * 100),
  };
}

// ---------------------------------------------------------------- 지금 주가가 가정하는 성장률(역산)

// 시가총액 = 앞으로 10년 순이익(연 g% 성장)을 할인한 값 + 10년 뒤 가치. 그 g를 찾아요.
export const DISCOUNT = { KR: 0.09, US: 0.08 } as const; // 요구 수익률
export const TERMINAL_GROWTH = 0.025;
export function valueAt(earnings: number, g: number, r: number, years = 10): number {
  let v = 0, e = earnings;
  for (let t = 1; t <= years; t++) { e *= 1 + g; v += e / (1 + r) ** t; }
  const terminal = (e * (1 + TERMINAL_GROWTH)) / (r - TERMINAL_GROWTH);
  return v + terminal / (1 + r) ** years;
}
export function impliedGrowth(marketCap: number | null, earnings: number | null, r: number): number | null {
  if (!marketCap || !earnings || earnings <= 0 || marketCap <= 0) return null;
  let lo = -0.5, hi = 1.0;
  if (valueAt(earnings, lo, r) > marketCap || valueAt(earnings, hi, r) < marketCap) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(earnings, mid, r) < marketCap) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

// 연간 값으로 본 지난 몇 년 실제 성장률(연평균). 처음·마지막 해가 흑자일 때만.
export function pastGrowth(rows: StatementRow[], item: string): { pct: number; years: number } | null {
  const y = [...table(rows, "Y").entries()].filter(([, v]) => v.has(item)).sort(([a], [b]) => a.localeCompare(b));
  if (y.length < 2) return null;
  const first = y[0][1].get(item)!, last = y.at(-1)![1].get(item)!, n = Number(y.at(-1)![0]) - Number(y[0][0]);
  if (first <= 0 || last <= 0 || n <= 0) return null;
  return { pct: ((last / first) ** (1 / n) - 1) * 100, years: n };
}

export function impliedSentence(g: number | null, past: { pct: number; years: number } | null): string {
  if (g === null) return "적자이거나 숫자가 모자라서 계산하지 않았어요.";
  const base = g >= 0 ? `지금 주가가 맞으려면 앞으로 10년 동안 순이익이 연 ${g.toFixed(1)}%씩 늘면 돼요.`
    : `지금 주가는 앞으로 10년 동안 순이익이 연 ${Math.abs(g).toFixed(1)}%씩 줄어드는 것까지 견디는 값이에요.`;
  if (!past) return base;
  const cmp = past.pct > g + 3 ? "지난 성장보다 낮은 기대라, 그만큼만 자라도 주가가 버틸 수 있어요." : past.pct < g - 3 ? "지난 성장보다 높은 기대가 들어 있어요. 더 빨리 자라야 해요." : "지난 성장과 비슷한 기대예요.";
  return `${base} 지난 ${past.years}년 실제로는 연 ${past.pct.toFixed(1)}%였어요. ${cmp}`;
}
