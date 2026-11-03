// 연습하기 › 실험실: 매매 규칙과 워커(worker/app/lab.py)가 돌린 결과. DB와 무관한 순수 함수입니다.

export const BUY_KEYS = ["ma20", "rsi30", "high52", "vol2", "support"] as const;
export type BuyKey = (typeof BUY_KEYS)[number];
export const BUY_LABEL: Record<BuyKey, string> = {
  ma20: "20일선 위", rsi30: "RSI 30 아래", high52: "52주 신고가", vol2: "거래량 2배", support: "지지선 터치",
};
export const BUY_HINT: Record<BuyKey, string> = {
  ma20: "종가가 20일 이동평균선 위",
  rsi30: "RSI(14)가 30 아래, 많이 빠진 날",
  high52: "종가가 지난 1년 중 가장 높음",
  vol2: "거래량이 지난 20일 평균의 2배 이상",
  support: "지난 60일 최저가 위 2% 안까지 내려왔다가 그 위에서 마감",
};
export type Market = "KR" | "US" | "ALL";
export const MARKETS: { key: Market; label: string }[] = [{ key: "KR", label: "국내" }, { key: "US", label: "미국" }, { key: "ALL", label: "둘 다" }];
export const YEARS = [1, 3, 5] as const;

export type Rule = {
  buy: Record<BuyKey, boolean>;
  sell: { stop: number | null; target: number | null; days: number | null; ma20break: boolean };
  market: Market;
  years: number;
};

export type Trade = { t: string; n: string; m: string; b: string; s: string; bp: number; sp: number; r: number; d: number; why: string; hold: number };
export type Result = {
  n: number; wins: number; winPct: number | null; avg: number | null; worst: number | null; best: number | null; avgDays: number | null;
  hold: number | null; avgWin: number | null; avgLoss: number | null; hist: number[]; bins: number[];
  tickers?: number; since?: string; until?: string; trades?: Trade[]; kept?: number; seconds?: number;
};
export type LabRule = { id: number; name: string; rule: Rule; status: "queued" | "running" | "done" | "error"; error: string | null; result: Result | null; doneAt: string | null };

export const DEFAULT_RULE: Rule = {
  buy: { ma20: true, rsi30: true, high52: false, vol2: false, support: false },
  sell: { stop: 7, target: 15, days: 20, ma20break: false },
  market: "ALL",
  years: 5,
};

const posNum = (v: unknown, lo: number, hi: number): number | null => {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.round(Math.min(Math.max(x, lo), hi) * 100) / 100;
};

/** 폼·AI·DB에서 온 규칙을 정해진 칸만 남겨 정리. 살 때·팔 때 조건이 없으면 errors에 담아요. */
export function cleanRule(raw: unknown): { rule: Rule; errors: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bi = (r.buy && typeof r.buy === "object" ? r.buy : {}) as Record<string, unknown>;
  const si = (r.sell && typeof r.sell === "object" ? r.sell : {}) as Record<string, unknown>;
  const buy = Object.fromEntries(BUY_KEYS.map((k) => [k, Boolean(bi[k])])) as Rule["buy"];
  const days = posNum(si.days, 1, 250);
  const sell = { stop: posNum(si.stop, 0.5, 90), target: posNum(si.target, 0.5, 500), days: days ? Math.round(days) : null, ma20break: Boolean(si.ma20break) };
  const market: Market = r.market === "KR" || r.market === "US" ? r.market : "ALL";
  const y = Number(r.years);
  const years = (YEARS as readonly number[]).includes(y) ? y : 5;
  const errors: string[] = [];
  if (!BUY_KEYS.some((k) => buy[k])) errors.push("살 때 조건을 하나 이상 골라 주세요.");
  if (!sell.stop && !sell.target && !sell.days && !sell.ma20break) errors.push("팔 때 조건을 하나 이상 골라 주세요.");
  return { rule: { buy, sell, market, years }, errors };
}

/** "20일선 위 + RSI 30 아래 → 손절 −7% · 익절 +15% · 20일 뒤" */
export function describe(rule: Rule): { buy: string[]; sell: string[] } {
  const sell: string[] = [];
  if (rule.sell.stop) sell.push(`손절 −${rule.sell.stop}%`);
  if (rule.sell.target) sell.push(`익절 +${rule.sell.target}%`);
  if (rule.sell.days) sell.push(`${rule.sell.days}일 뒤`);
  if (rule.sell.ma20break) sell.push("20일선 이탈");
  return { buy: BUY_KEYS.filter((k) => rule.buy[k]).map((k) => BUY_LABEL[k]), sell };
}

export const marketLabel = (m: Market) => MARKETS.find((x) => x.key === m)?.label ?? "둘 다";

export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);

/** 그냥 들고 있기 대비(%p). */
export function edge(r: Result): number | null {
  return r.avg === null || r.hold === null ? null : Math.round((r.avg - r.hold) * 100) / 100;
}

export type DuelSort = "avg" | "win" | "safe";
export const DUEL_SORTS: { key: DuelSort; label: string }[] = [{ key: "avg", label: "평균순" }, { key: "win", label: "이긴 비율순" }, { key: "safe", label: "덜 잃는 순" }];

/** 결과가 있는 규칙을 고른 기준으로 줄 세워요(거래가 없으면 뒤로). */
export function sortDuel(rules: LabRule[], by: DuelSort): LabRule[] {
  const v = (x: LabRule) => {
    const r = x.result;
    if (!r || !r.n) return -Infinity;
    return by === "avg" ? r.avg ?? -Infinity : by === "win" ? r.winPct ?? -Infinity : r.worst ?? -Infinity;
  };
  return [...rules].sort((a, b) => v(b) - v(a));
}

export type TradeFilter = "all" | "win" | "loss" | "big";
export const TRADE_FILTERS: { key: TradeFilter; label: string }[] = [
  { key: "all", label: "전체" }, { key: "win", label: "이긴 거래" }, { key: "loss", label: "진 거래" }, { key: "big", label: "크게 잃은 거래" },
];
export const BIG_LOSS = -10;

export function filterTrades(trades: Trade[], f: TradeFilter): Trade[] {
  if (f === "win") return trades.filter((t) => t.r > 0);
  if (f === "loss") return trades.filter((t) => t.r <= 0);
  if (f === "big") return trades.filter((t) => t.r <= BIG_LOSS).sort((a, b) => a.r - b.r);
  return trades;
}

/** 내 실제 매매(매도 기록)와 이긴 비율·평균 수익이 가장 가까운 규칙. 이긴 비율 10%p ≈ 평균 1%p로 봐요. */
export function closestRule(rules: LabRule[], mine: { winRate: number | null; avgReturn: number | null }): LabRule | null {
  if (mine.winRate === null || mine.avgReturn === null) return null;
  let best: LabRule | null = null;
  let gap = Infinity;
  for (const x of rules) {
    const r = x.result;
    if (!r || !r.n || r.winPct === null || r.avg === null) continue;
    const d = Math.hypot((r.winPct - mine.winRate) / 10, r.avg - mine.avgReturn);
    if (d < gap) { gap = d; best = x; }
  }
  return best;
}

/** 히스토그램 칸 이름: "−20% 아래", "−20~−17.5", …, "+20% 넘게" */
export function binLabels(bins: number[]): string[] {
  const f = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;
  return [`${f(bins[0])}% 아래`, ...bins.slice(0, -1).map((b, i) => `${f(b)}~${f(bins[i + 1])}%`), `${f(bins.at(-1)!)}% 넘게`];
}

/** 히스토그램 칸 색: 칸 위쪽 경계가 0 이하면 손실(파랑). */
export function binIsLoss(bins: number[], k: number): boolean {
  return k === 0 || (k <= bins.length - 1 && bins[k] <= 0);
}

/** 거래 하나를 차트에 그릴 때 보는 기간: 산 날 60봉 전 ~ 판 날 30봉 뒤 */
export function chartWindow(days: string[], buy: string, sell: string, before = 60, after = 30): [number, number] {
  const b = days.findIndex((d) => d >= buy);
  let s = days.findIndex((d) => d >= sell);
  if (s < 0) s = days.length - 1;
  const from = Math.max(0, (b < 0 ? 0 : b) - before);
  return [from, Math.min(days.length, s + after + 1)];
}

export const tradeKey = (t: Trade) => `${t.t}_${t.b}`;
