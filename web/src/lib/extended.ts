// 미국 프리·애프터마켓: 워커(worker/app/extended.py)가 5분마다 받은 장외 가격을 보유 목록에 붙여요.
export type ExtSession = "pre" | "post";
export type ExtQuote = { ticker: string; session: ExtSession; price: number; base: number; fetched_at: Date };

export const SESSION_LABEL: Record<ExtSession, string> = { pre: "프리", post: "애프터" };

// 뉴욕 시간 평일 04:00–09:30 프리, 16:00–20:00 애프터 (휴장일은 워커가 안 받아서 저절로 빠져요)
export function nySession(now: Date): ExtSession | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return null;
  const m = Number(parts.hour) * 60 + Number(parts.minute);
  if (m >= 240 && m < 570) return "pre";
  if (m >= 960 && m < 1200) return "post";
  return null;
}

// 지금 구간에 받은 지 20분 안 된 값만 써요.
export function liveQuotes(rows: ExtQuote[], now: Date): Map<string, ExtQuote> {
  const session = nySession(now);
  return new Map(rows.filter((q) => q.session === session && now.getTime() - new Date(q.fetched_at).getTime() < 20 * 60 * 1000).map((q) => [q.ticker, q]));
}

export const extPct = (q: Pick<ExtQuote, "price" | "base">) => (q.base > 0 ? (q.price / q.base - 1) * 100 : 0);
// 정규장 종가 대비 원화 손익(환율이 없으면 null)
export const extWon = (q: Pick<ExtQuote, "price" | "base">, quantity: number, rate: number) => (rate > 0 ? quantity * (q.price - q.base) * rate : null);
