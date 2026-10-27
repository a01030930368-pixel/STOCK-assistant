// 종목 화면 › 이름 아래 실시간 가격 줄. 워커(worker/app/live.py)가 app_settings 'live:<종목>'에 덧붙인 값을 써요.

export type LiveValue = {
  market?: string; seen?: string;
  price?: number; change?: number | null; change_pct?: number | null; at?: string; open?: boolean;
  error?: string | null; error_at?: string;
};
export type Quote = { price: number; change: number | null; pct: number | null };
export type Holding = { quantity: number; avg: number };

export const POLL_MS = 3000;

// 직전 종가와 지금 가격으로 전일 대비. 오늘 봉이 이미 쌓였으면 그 앞 봉이 직전 종가예요.
export function prevClose(candles: { day: string; close: number }[], today: string): number | null {
  const before = candles.filter((c) => c.day < today);
  return before.at(-1)?.close ?? null;
}
export function quoteFrom(price: number, prev: number | null): Quote {
  if (!prev) return { price, change: null, pct: null };
  return { price, change: price - prev, pct: (price / prev - 1) * 100 };
}
export function quoteOf(v: LiveValue | null): Quote | null {
  if (!v || typeof v.price !== "number") return null;
  return { price: v.price, change: v.change ?? null, pct: v.change_pct ?? null };
}

// 몇 초 전에 받은 값인지. 1분 넘으면 분, 1시간 넘으면 시각으로 말해요.
export function ago(at: string | undefined, now: number): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

// 내 종목이면 평단 대비와 평가손익.
export function mine(h: Holding | null, price: number): { pct: number; pnl: number } | null {
  if (!h || h.quantity <= 0 || h.avg <= 0) return null;
  return { pct: (price / h.avg - 1) * 100, pnl: (price - h.avg) * h.quantity };
}

// 국내 계좌와 ISA에 나눠 든 종목은 수량으로 가중한 평단을 써요.
export function combine(rows: { quantity: number; avg: number }[]): Holding | null {
  const q = rows.reduce((a, r) => a + r.quantity, 0);
  if (q <= 0) return null;
  return { quantity: q, avg: rows.reduce((a, r) => a + r.quantity * r.avg, 0) / q };
}

export const tone = (v: number | null | undefined) => (!v ? "" : v > 0 ? "up" : "down");
export const arrow = (v: number | null | undefined) => (!v ? "" : v > 0 ? "▲" : "▼");
