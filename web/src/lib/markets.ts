// 매크로 환경 › 국내·해외 지수 카드. 워커(worker/app/markets.py)가 sector_daily에 market 'MK'로 넣은 일봉을 써요.

export type Tab = "KR" | "US";
export type Unit = "pt" | "won" | "usd" | "rate";
export type Meta = { code: string; name: string; tab: Tab; unit: Unit; digits: number; hint?: string; ref?: number };
export type Point = { day: string; close: number };

export const MARKETS: Meta[] = [
  { code: "KOSPI", name: "코스피", tab: "KR", unit: "pt", digits: 2 },
  { code: "KOSDAQ", name: "코스닥", tab: "KR", unit: "pt", digits: 2 },
  { code: "KOSPI200", name: "코스피200", tab: "KR", unit: "pt", digits: 2 },
  { code: "USDKRW", name: "원/달러", tab: "KR", unit: "won", digits: 1 },
  { code: "JPYKRW", name: "원/엔(100엔)", tab: "KR", unit: "won", digits: 1 },
  { code: "KR3Y", name: "국고채 3년", tab: "KR", unit: "rate", digits: 2 },
  { code: "KR10Y", name: "국고채 10년", tab: "KR", unit: "rate", digits: 2 },
  { code: "SPX", name: "S&P 500", tab: "US", unit: "pt", digits: 1 },
  { code: "NASDAQ", name: "나스닥", tab: "US", unit: "pt", digits: 1 },
  { code: "DOW", name: "다우", tab: "US", unit: "pt", digits: 1 },
  { code: "SOX", name: "반도체(SOX)", tab: "US", unit: "pt", digits: 1 },
  { code: "VIX", name: "VIX(공포지수)", tab: "US", unit: "pt", digits: 2, hint: "20 넘으면 불안, 30 넘으면 공포", ref: 20 },
  { code: "US10Y", name: "미국 10년 금리", tab: "US", unit: "rate", digits: 2 },
  { code: "US2Y", name: "미국 2년 금리", tab: "US", unit: "rate", digits: 2 },
  { code: "DXY", name: "달러인덱스", tab: "US", unit: "pt", digits: 2 },
  { code: "WTI", name: "WTI 유가", tab: "US", unit: "usd", digits: 2 },
  { code: "GOLD", name: "금", tab: "US", unit: "usd", digits: 0 },
  { code: "BTC", name: "비트코인", tab: "US", unit: "usd", digits: 0 },
];
export const metaOf = (code: string) => MARKETS.find((m) => m.code === code);

export type Period = "1m" | "3m" | "1y";
export const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: "1m", label: "1개월", days: 31 }, { key: "3m", label: "3개월", days: 92 }, { key: "1y", label: "1년", days: 366 },
];

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

// 마지막 봉에서 기간만큼 거슬러 올라간 구간. 시작점 바로 앞 봉 하나를 붙여 기간 등락의 기준으로 써요.
export function slice(points: Point[], period: Period): Point[] {
  if (!points.length) return [];
  const from = shift(points.at(-1)!.day, PERIODS.find((p) => p.key === period)!.days);
  const i = points.findIndex((p) => p.day >= from);
  return points.slice(Math.max(0, i - 1));
}

export type Change = { abs: number; pct: number };
const change = (from: number, to: number): Change => ({ abs: to - from, pct: from ? (to / from - 1) * 100 : 0 });

export type CardData = { meta: Meta; last: Point | null; day: Change | null; period: Change | null; points: Point[] };
export function cardData(meta: Meta, all: Point[], period: Period): CardData {
  const points = slice(all, period);
  const last = all.at(-1) ?? null, prev = all.at(-2);
  return {
    meta, last, points,
    day: last && prev ? change(prev.close, last.close) : null,
    period: points.length >= 2 ? change(points[0].close, last!.close) : null,
  };
}

export function fmtValue(m: Meta, v: number): string {
  const n = v.toLocaleString("ko-KR", { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits });
  return m.unit === "rate" ? `${n}%` : m.unit === "usd" ? `$${n}` : n;
}

// 금리는 %p(차이), 나머지는 %(비율)로 등락을 말해요.
export function fmtChange(m: Meta, c: Change | null): string {
  if (!c) return "-";
  if (m.unit === "rate") return `${c.abs >= 0 ? "+" : ""}${c.abs.toFixed(2)}%p`;
  return `${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(1)}%`;
}
export const dir = (m: Meta, c: Change | null) => (!c ? "" : (m.unit === "rate" ? c.abs : c.pct) > 0 ? "up" : (m.unit === "rate" ? c.abs : c.pct) < 0 ? "down" : "");

// 겹쳐 보기: 시작=100. 기준 구간의 첫날보다 늦게 시작하는 지수는 그 지수의 첫날을 100으로 잡아요.
export function indexed(points: Point[], from: string): Point[] {
  const xs = points.filter((p) => p.day >= from);
  const base = xs[0]?.close;
  return base ? xs.map((p) => ({ day: p.day, close: (p.close / base) * 100 })) : [];
}

// 미니 차트 선 좌표(0~w, 0~h). 기준선(ref)이 있으면 범위에 넣어 같이 그려요.
export function sparkPath(points: Point[], w: number, h: number, ref?: number): { line: string; refY: number | null } {
  if (points.length < 2) return { line: "", refY: null };
  const vals = points.map((p) => p.close);
  const lo = Math.min(...vals, ref ?? Infinity), hi = Math.max(...vals, ref ?? -Infinity);
  const span = hi - lo || 1, y = (v: number) => h - ((v - lo) / span) * h;
  const line = vals.map((v, i) => `${((i * w) / (vals.length - 1)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return { line, refY: ref === undefined ? null : y(ref) };
}

// 겹쳐 볼 선 색. 오름(빨강)·내림(파랑)과 헷갈리지 않는 색을 정해진 순서로 써요.
export const OVERLAY_COLORS = ["#c9a96b", "#7fb8a0", "#b48ead", "#e0a458", "#6fb3c8", "#d68fb0"];
export const MAX_OVERLAY = OVERLAY_COLORS.length - 1;

// 두 번 누르기: 같은 카드를 TAP_MS 안에 두 번 누르면 true.
export const TAP_MS = 400;
export function isDoubleTap(prev: { code: string; at: number } | null, code: string, at: number): boolean {
  return !!prev && prev.code === code && at - prev.at <= TAP_MS;
}
