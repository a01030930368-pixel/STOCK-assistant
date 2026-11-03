// 위기 리허설: "코스피가 −20% 빠지면 내 계좌는?"과 "지금 계좌로 2020년 3월을 다시 겪는다면".
// 숫자로 하는 상황은 종목마다 지난 1년 베타(시장보다 얼마나 더 움직였나)를 곱해서 어림해요.
// 예측이 아니라 "이 정도 흔들릴 수 있다"를 미리 보는 계산이에요.

export type Account = "KR" | "ISA" | "US";
export type Close = { day: string; close: number };

export type CrisisHolding = {
  ticker: string; name: string; account: Account;
  price: number;   // 지금 가격(국내 원, 미국 달러)
  value: number;   // 지금 평가액(원화)
  usd?: number;    // 미국 종목 평가액(달러)
  semi: boolean;   // 반도체 업종
  stop: number | null; // 손절가(그 종목 통화)
  beta: number; betaKnown: boolean;
};
export type CrisisCash = { krw: number; usd: number }; // 원화 예수금(일반+ISA), 달러 예수금

export type Scenario = {
  id: string; label: string; icon: string; sub: string;
  kospi?: number; nasdaq?: number; fx?: number; semi?: number; // %, %, 원/달러, %
};
export type Window = { id: string; label: string; icon: string; sub: string; start: string; shown: string; end: string };

export const SCENARIOS: Scenario[] = [
  { id: "kospi20", label: "코스피 −20%", icon: "📉", sub: "국내 종목에 베타 곱해서", kospi: -20 },
  { id: "nasdaq30", label: "나스닥 −30%", icon: "📉", sub: "미국 종목", nasdaq: -30 },
  { id: "fx1500", label: "환율 1,500원", icon: "💱", sub: "미국 주식·달러 원화 값", fx: 1500 },
  { id: "semi25", label: "반도체 −25%", icon: "🔻", sub: "반도체 업종만", semi: -25 },
];
// worker/app/crisis.py WINDOWS와 같아야 해요. shown까지 그리고, end까지는 회복을 봐요.
export const WINDOWS: Window[] = [
  { id: "covid", label: "2020년 3월 코로나", icon: "🦠", sub: "코스피 −36%", start: "2020-02-17", shown: "2020-05-15", end: "2020-12-30" },
  { id: "rate2022", label: "2022년 금리 인상", icon: "📈", sub: "나스닥 −35%", start: "2022-01-03", shown: "2022-10-14", end: "2023-06-30" },
  { id: "aug2024", label: "2024년 8월 5일", icon: "💥", sub: "코스피 −8.8% 하루", start: "2024-07-31", shown: "2024-08-30", end: "2024-12-30" },
];

const ACCOUNT_INDEX: Record<Account, "KOSPI" | "NASDAQ"> = { KR: "KOSPI", ISA: "KOSPI", US: "NASDAQ" };
export const indexOf = (a: Account) => ACCOUNT_INDEX[a];

// ---------------------------------------------------------------- 베타

/** 지난 1년(최대 250번) 같은 날 등락으로 잰 베타. 60번이 안 되면 null. 0~3 사이로 잘라요. */
export function beta(stock: Close[], index: Close[], max = 250): number | null {
  const idx = new Map(index.map((c) => [c.day, c.close]));
  const pairs = stock.filter((c) => idx.has(c.day)).sort((a, b) => a.day.localeCompare(b.day));
  const xs: number[] = [], ys: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    const s0 = pairs[i - 1].close, s1 = pairs[i].close, m0 = idx.get(pairs[i - 1].day)!, m1 = idx.get(pairs[i].day)!;
    if (s0 > 0 && m0 > 0) { ys.push(s1 / s0 - 1); xs.push(m1 / m0 - 1); }
  }
  const x = xs.slice(-max), y = ys.slice(-max);
  if (x.length < 60) return null;
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let cov = 0, vr = 0;
  for (let i = 0; i < x.length; i++) { cov += (x[i] - mx) * (y[i] - my); vr += (x[i] - mx) ** 2; }
  if (vr === 0) return null;
  return Math.round(Math.min(3, Math.max(0, cov / vr)) * 100) / 100;
}

// ---------------------------------------------------------------- 숫자로 하는 상황

export type ShockRow = {
  ticker: string; name: string; account: Account; change: number; ratio: number; after: number;
  beta: number; betaKnown: boolean; stop: number | null; priceAfter: number; hit: boolean;
};
export type ShockResult = {
  before: number; after: number; change: number; pct: number;
  byAccount: { KR: number; ISA: number; usPrice: number; usFx: number; cashFx: number };
  cashBefore: number; cashAfter: number; // 현금 비중(%)
  rows: ShockRow[]; hits: ShockRow[]; rate: number; rateAfter: number; guessed: number; // 베타를 몰라 1로 둔 종목 수
};

const floor = (r: number) => Math.max(0.05, r);

export function priceRatio(h: CrisisHolding, s: Scenario): number {
  const market = h.account === "US" ? s.nasdaq ?? 0 : s.kospi ?? 0;
  let r = 1 + (h.beta * market) / 100;
  if (h.semi && s.semi) r *= 1 + s.semi / 100;
  return floor(r);
}

export function shock(holdings: CrisisHolding[], cash: CrisisCash, rate: number, s: Scenario): ShockResult {
  const rateAfter = s.fx && rate > 0 ? s.fx : rate;
  const fxR = rate > 0 ? rateAfter / rate : 1;
  const by = { KR: 0, ISA: 0, usPrice: 0, usFx: 0, cashFx: 0 };
  const rows: ShockRow[] = holdings.map((h) => {
    const ratio = priceRatio(h, s);
    const after = h.account === "US" ? h.value * ratio * fxR : h.value * ratio;
    if (h.account === "US") { by.usPrice += h.value * (ratio - 1); by.usFx += h.value * ratio * (fxR - 1); }
    else by[h.account] += after - h.value;
    const priceAfter = h.price * ratio;
    return {
      ticker: h.ticker, name: h.name, account: h.account, change: after - h.value, ratio, after,
      beta: h.beta, betaKnown: h.betaKnown, stop: h.stop, priceAfter, hit: h.stop !== null && priceAfter <= h.stop,
    };
  });
  const cashKrw = cash.krw + cash.usd * rate;
  by.cashFx = cash.usd * (rateAfter - rate);
  const before = holdings.reduce((a, h) => a + h.value, 0) + cashKrw;
  const cashAfterKrw = cashKrw + by.cashFx;
  const after = rows.reduce((a, r) => a + r.after, 0) + cashAfterKrw;
  rows.sort((a, b) => a.change - b.change);
  return {
    before, after, change: after - before, pct: before > 0 ? ((after - before) / before) * 100 : 0, byAccount: by,
    cashBefore: before > 0 ? (cashKrw / before) * 100 : 0, cashAfter: after > 0 ? (cashAfterKrw / after) * 100 : 0,
    rows, hits: rows.filter((r) => r.hit), rate, rateAfter, guessed: holdings.filter((h) => !h.betaKnown).length,
  };
}

// ---------------------------------------------------------------- 그때 그대로 다시 겪기

export type ReplayPoint = { day: string; mine: number; kospi: number | null };
export type Replay = {
  points: ReplayPoint[];            // 화면에 그릴 구간(시작 전날 = 지금 계좌 값)
  start: number;
  troughPct: number; troughWon: number; troughDay: string;
  recoverDays: number | null;       // 원래 값으로 돌아오기까지(달력 날수). 회복 구간 안에 못 오면 null
  kospiRecoverDays: number | null;
  worstPct: number; worstDay: string;
  hits: { ticker: string; name: string; day: string }[];
  heldEndPct: number; soldEndPct: number; // 구간 끝(shown) 기준: 그대로 들고 있었으면 / 손절가대로 팔았으면
  proxies: string[];                // 그때 없던 종목(지수×베타로 대신 계산)
  fxKnown: boolean;
};

/** day 이하의 마지막 종가(앞의 값 이어 쓰기) */
function lookup(rows: Close[]): (day: string) => number | null {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  return (day: string) => {
    let lo = 0, hi = sorted.length - 1, ans: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].day <= day) { ans = sorted[mid].close; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function replay(holdings: CrisisHolding[], cash: CrisisCash, rate: number, series: Map<string, Close[]>, w: Window): Replay | null {
  const kospi = (series.get("KOSPI") ?? []).filter((c) => c.day <= w.end).sort((a, b) => a.day.localeCompare(b.day));
  const before = kospi.filter((c) => c.day < w.start);
  const inside = kospi.filter((c) => c.day >= w.start);
  if (before.length === 0 || inside.length < 2) return null;
  const axis = [before[before.length - 1].day, ...inside.map((c) => c.day)];
  const base = axis[0];
  const K = lookup(kospi), N = lookup(series.get("NASDAQ") ?? []), F = lookup(series.get("USDKRW") ?? []);
  const fxBase = F(base);
  const fxKnown = fxBase !== null && fxBase > 0;
  const fxRatio = (d: string) => (fxKnown ? (F(d) ?? fxBase!) / fxBase! : 1);
  const proxies: string[] = [];

  // 종목마다 날짜별 가격 비율(통화는 그 종목 그대로)
  const ratios = holdings.map((h) => {
    const own = series.get(h.ticker);
    const L = own ? lookup(own) : null;
    const b = L ? L(base) : null;
    if (L && b && b > 0) return axis.map((d) => (L(d) ?? b) / b);
    proxies.push(h.name);
    const I = h.account === "US" ? N : K;
    const ib = I(base);
    if (!ib) return axis.map(() => 1);
    return axis.map((d) => floor(1 + h.beta * ((I(d) ?? ib) / ib - 1)));
  });
  const cashAt = (d: string) => cash.krw + cash.usd * rate * fxRatio(d);
  const mineAt = (t: number) => holdings.reduce((a, h, i) => a + h.value * ratios[i][t] * (h.account === "US" ? fxRatio(axis[t]) : 1), 0) + cashAt(axis[t]);

  const all = axis.map((_, t) => mineAt(t));
  const start = all[0];
  const kb = K(base)!;
  const shownN = axis.filter((d) => d <= w.shown).length;
  const points: ReplayPoint[] = axis.slice(0, shownN).map((day, t) => ({ day, mine: all[t], kospi: K(day) !== null ? (start * K(day)!) / kb : null }));

  let tr = 0;
  for (let t = 1; t < shownN; t++) if (all[t] < all[tr]) tr = t;
  let rec: number | null = null;
  for (let t = tr + 1; t < all.length; t++) if (all[t] >= start) { rec = daysBetween(base, axis[t]); break; }
  let krec: number | null = null, ktr = 0;
  for (let t = 1; t < shownN; t++) if ((K(axis[t]) ?? kb) < (K(axis[ktr]) ?? kb)) ktr = t;
  for (let t = ktr + 1; t < axis.length; t++) if ((K(axis[t]) ?? 0) >= kb) { krec = daysBetween(base, axis[t]); break; }
  let worst = 0, worstDay = axis[1] ?? base;
  for (let t = 1; t < shownN; t++) {
    const p = (all[t] / all[t - 1] - 1) * 100;
    if (p < worst) { worst = p; worstDay = axis[t]; }
  }

  // 손절가에 닿은 종목과, 닿은 날 손절가에 팔았다면
  const hits: Replay["hits"] = [];
  let sold = cashAt(axis[shownN - 1]);
  holdings.forEach((h, i) => {
    const fxEnd = h.account === "US" ? fxRatio(axis[shownN - 1]) : 1;
    let at = -1;
    if (h.stop !== null && h.price > 0) {
      const line = h.stop / h.price;
      for (let t = 1; t < shownN; t++) if (ratios[i][t] <= line) { at = t; break; }
    }
    if (at < 0) { sold += h.value * ratios[i][shownN - 1] * fxEnd; return; }
    hits.push({ ticker: h.ticker, name: h.name, day: axis[at] });
    const r = Math.min(ratios[i][at], h.stop! / h.price); // 갭 하락이면 그날 값에 팔려요
    sold += h.value * r * (h.account === "US" ? fxRatio(axis[at]) : 1);
  });

  return {
    points, start,
    troughPct: (all[tr] / start - 1) * 100, troughWon: all[tr] - start, troughDay: axis[tr],
    recoverDays: rec, kospiRecoverDays: krec, worstPct: worst, worstDay, hits,
    heldEndPct: (all[shownN - 1] / start - 1) * 100, soldEndPct: (sold / start - 1) * 100,
    proxies, fxKnown,
  };
}

// ---------------------------------------------------------------- 글자

/** −1,240만 원 / +48만 원 / −3,200원 */
export function manwon(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 10_000) return `${sign}${Math.round(a / 10_000).toLocaleString("ko-KR")}만 원`;
  return `${sign}${Math.round(a).toLocaleString("ko-KR")}원`;
}
export const pct = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;

export function scenarioOf(id: string | undefined): Scenario | Window {
  return SCENARIOS.find((s) => s.id === id) ?? WINDOWS.find((w) => w.id === id) ?? SCENARIOS[0];
}
export const isWindow = (s: Scenario | Window): s is Window => "start" in s;
