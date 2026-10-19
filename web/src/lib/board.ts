export type Market = "KR" | "US";
export type Scope = "all" | Market;

export function scopeOf(raw: string | string[] | undefined): Scope {
  return raw === "KR" || raw === "US" ? raw : "all";
}

export type Account = { eval: number; buy: number; pnl: number; cash: number | null };

// 총자산 = 주식 평가 + 남은 예수금. 전체는 원화로 맞추고, 해외만 볼 때는 달러로 둡니다.
export function totalOf(scope: Scope, kr: Account | null, us: Account | null, rate: number) {
  const parts: { acc: Account; fx: number }[] = [];
  if (scope !== "US" && kr) parts.push({ acc: kr, fx: 1 });
  if (scope !== "KR" && us) parts.push({ acc: us, fx: scope === "US" ? 1 : rate });
  const sum = (f: (a: Account) => number) => parts.reduce((s, p) => s + f(p.acc) * p.fx, 0);
  const buy = sum((a) => a.buy);
  const pnl = sum((a) => a.pnl);
  return {
    currency: scope === "US" ? "USD" : "KRW",
    stocks: sum((a) => a.eval),
    cash: sum((a) => a.cash ?? 0),
    total: sum((a) => a.eval + (a.cash ?? 0)),
    pnl,
    pnlPct: buy > 0 ? (pnl / buy) * 100 : 0,
  } as const;
}

export type Alert = { kind: "stop" | "target" | "custom"; direction: "below" | "above"; price: number; cur: number };

// 현재가에서 알림 가격까지 남은 거리(%). 이미 넘었으면 0.
export function distancePct(a: Alert): number {
  if (a.cur <= 0) return Infinity;
  const gap = a.direction === "below" ? a.cur - a.price : a.price - a.cur;
  return Math.max(0, (gap / a.cur) * 100);
}
