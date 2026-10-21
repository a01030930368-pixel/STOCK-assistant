// 미국 주식 원화 수익을 "주가로 번 돈"과 "환율로 번 돈"으로 나눕니다.
//   주가로 = (지금 가격 − 평단) × 수량 × 산 때 환율
//   환율로 = 지금 가격 × 수량 × (지금 환율 − 산 때 환율)
// 둘을 더하면 원화로 번 돈(지금 원화 평가 − 산 때 원화 금액)이 돼요.
// 산 때 환율은 지금 들고 있는 주식을 산 날들의 환율을 수량으로 평균 낸 값이에요(먼저 산 것부터 판 것으로 셈).

export type FxFill = { ticker: string; day: string; side: "buy" | "sell"; quantity: number };
export type FxDay = { day: string; rate: number };
export type FxHolding = { ticker: string; name: string; quantity: number; avg: number; cur: number };
export type FxRow = FxHolding & {
  buyRate: number | null; // 산 때 평균 환율
  price: number; fx: number; total: number; // 원
  unknown: number; // 체결 기록보다 오래돼 산 날을 모르는 수량
};

// 지금 들고 있는 수량이 어느 날 산 것인지(먼저 산 것부터 판 것으로)
export function lotsHeld(fills: FxFill[], quantity: number): { day: string; quantity: number }[] {
  const lots: { day: string; quantity: number }[] = [];
  for (const f of [...fills].sort((a, b) => a.day.localeCompare(b.day) || (a.side === "buy" ? -1 : 1))) {
    if (f.side === "buy") {
      lots.push({ day: f.day, quantity: f.quantity });
      continue;
    }
    let left = f.quantity;
    while (left > 1e-9 && lots.length) {
      const take = Math.min(left, lots[0].quantity);
      lots[0].quantity -= take;
      left -= take;
      if (lots[0].quantity <= 1e-9) lots.shift();
    }
  }
  // 기록이 지금 수량보다 많으면(기록 밖에서 판 경우) 최근에 산 것만 남겨요.
  let extra = lots.reduce((s, l) => s + l.quantity, 0) - quantity;
  while (extra > 1e-9 && lots.length) {
    const take = Math.min(extra, lots[0].quantity);
    lots[0].quantity -= take;
    extra -= take;
    if (lots[0].quantity <= 1e-9) lots.shift();
  }
  return lots;
}

// 그날 환율. 주말·휴일이면 그 전 영업일, 기록보다 이르면 가장 이른 기록을 써요. days는 날짜 오름차순.
export function rateOn(days: FxDay[], day: string): number | null {
  if (!days.length) return null;
  let lo = 0, hi = days.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].day <= day) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return days[Math.max(found, 0)].rate;
}

export function splitRow(h: FxHolding, fills: FxFill[], days: FxDay[], now: number): FxRow {
  const lots = lotsHeld(fills.filter((f) => f.ticker === h.ticker), h.quantity);
  const known = lots.reduce((s, l) => s + l.quantity, 0);
  const unknown = Math.max(0, h.quantity - known);
  // 산 날을 모르는 수량은 첫 체결 기록 날(없으면 가장 이른 환율 기록)의 환율로 셈해요.
  const fallback = rateOn(days, lots[0]?.day ?? fills.filter((f) => f.ticker === h.ticker).map((f) => f.day).sort()[0] ?? "0000-00-00");
  let weighted = 0;
  for (const l of lots) weighted += l.quantity * (rateOn(days, l.day) ?? 0);
  const buyRate = fallback === null ? null : h.quantity > 0 ? (weighted + unknown * fallback) / h.quantity : null;
  if (buyRate === null || !now) return { ...h, buyRate, price: 0, fx: 0, total: 0, unknown };
  const price = (h.cur - h.avg) * h.quantity * buyRate;
  const fx = h.cur * h.quantity * (now - buyRate);
  return { ...h, buyRate, price, fx, total: price + fx, unknown };
}

export function splitAll(holdings: FxHolding[], fills: FxFill[], days: FxDay[], now: number) {
  const rows = holdings.map((h) => splitRow(h, fills, days, now)).sort((a, b) => b.total - a.total);
  const ok = rows.filter((r) => r.buyRate !== null);
  const bought = ok.reduce((s, r) => s + r.avg * r.quantity, 0);
  return {
    rows,
    price: ok.reduce((s, r) => s + r.price, 0),
    fx: ok.reduce((s, r) => s + r.fx, 0),
    // 산 금액(달러)으로 가중한 평균 환율
    buyRate: bought > 0 ? ok.reduce((s, r) => s + r.avg * r.quantity * (r.buyRate ?? 0), 0) / bought : null,
    unknown: rows.some((r) => r.unknown > 0),
  };
}
