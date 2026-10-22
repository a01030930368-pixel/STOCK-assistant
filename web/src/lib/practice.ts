// 관심종목 › 연습하기: 지난 차트를 한 봉씩 넘기며 산다·판다·지켜본다를 연습해요.
// 주소에는 종목과 날짜가 바로 보이지 않게 섞어서 넣어요(보안용이 아니라 눈으로 안 보이게).

export const BEFORE = 120; // 시작 전에 보여 주는 봉 수(지표가 계산될 만큼)
export const STEPS = 60; // 시작 뒤로 넘길 봉 수
export const JUDGE = 5; // 산 뒤(판 뒤) 몇 봉 뒤 가격으로 맞았는지 봐요

export type Game = { ticker: string; start: string; blind: boolean };
export type Decision = { i: number; side: "buy" | "sell" };
export type Result = { returnPct: number; holdPct: number; calls: number; hits: number; trades: { i: number; side: "buy" | "sell"; price: number }[] };

const KEY = "lodestar";
const mix = (s: string) => Array.from(s, (c, k) => String.fromCharCode(c.charCodeAt(0) ^ KEY.charCodeAt(k % KEY.length))).join("");

export function encodeGame(g: Game): string {
  const raw = mix(`${g.ticker}|${g.start}|${g.blind ? 1 : 0}`);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeGame(token: string | undefined | null): Game | null {
  if (!token || token.length > 80) return null;
  try {
    const raw = mix(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
    const [ticker, start, blind] = raw.split("|");
    if (!/^[A-Z0-9.]{1,12}$/.test(ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !["0", "1"].includes(blind)) return null;
    return { ticker, start, blind: blind === "1" };
  } catch {
    return null;
  }
}

// 아무 시점: 앞에 BEFORE개, 뒤에 STEPS개 봉이 남는 자리 중에서 골라요. 자리가 없으면 null.
export function randomStart(days: string[], rand: () => number = Math.random): string | null {
  const lo = BEFORE, hi = days.length - 1 - STEPS;
  if (hi < lo) return null;
  return days[lo + Math.floor(rand() * (hi - lo + 1))];
}

// 산다는 남은 돈 전부로 그 봉 종가에, 판다는 가진 것 전부를 그 봉 종가에. 끝날 때 가진 건 마지막 종가로 셈해요.
export function score(closes: number[], start: number, end: number, decisions: Decision[]): Result {
  let money = 1, held: number | null = null, calls = 0, hits = 0;
  const trades: Result["trades"] = [];
  for (const d of [...decisions].sort((a, b) => a.i - b.i)) {
    if (d.i < start || d.i > end) continue;
    const p = closes[d.i];
    if (d.side === "buy" ? held !== null : held === null) continue; // 이미 샀는데 또 사기, 없는데 팔기는 넘어가요
    if (d.side === "buy") held = p;
    else { money *= p / held!; held = null; }
    trades.push({ i: d.i, side: d.side, price: p });
    const later = Math.min(d.i + JUDGE, end);
    if (later > d.i) {
      calls++;
      if (d.side === "buy" ? closes[later] > p : closes[later] < p) hits++;
    }
  }
  if (held !== null) money *= closes[end] / held;
  const pct = (v: number) => Math.round(v * 10000) / 100;
  return { returnPct: pct(money - 1), holdPct: pct(closes[end] / closes[start] - 1), calls, hits, trades };
}

// 가린 연습: 시작 봉 종가를 100으로 맞춰서 원래 가격대(=종목)를 짐작하지 못하게 해요. 모양은 그대로예요.
export function rescale<T extends { open: number; high: number; low: number; close: number }>(bars: T[], base: number): T[] {
  if (!(base > 0)) return bars;
  const k = 100 / base;
  return bars.map((b) => ({ ...b, open: b.open * k, high: b.high * k, low: b.low * k, close: b.close * k }));
}
