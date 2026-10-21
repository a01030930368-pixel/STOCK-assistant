// 매매 복기: 한 권(첫 매수 ~ 전량 매도)의 체결과 일봉으로 "내 결과", "계속 들고 있었다면", 같은 기간 지수를 같은 줄에 그리고,
// 산 뒤·판 뒤 주가가 어떻게 갔는지 한 줄씩 셉니다. DB와 무관한 순수 함수입니다.

export type Bar = { day: string; close: number; high?: number | null; low?: number | null };
export type Trade = { day: string; side: "buy" | "sell"; quantity: number; price: number; fee: number | null };
export const AFTER_DAYS = 20;

export type Curve = { days: string[]; closes: number[]; mine: number[]; held: number[]; bench: (number | null)[] };

// 첫 매수 날부터 오늘(또는 마지막 일봉)까지. 수익률은 넣은 돈(매수 금액+수수료) 대비 %.
// 내 결과 = (남은 주식 평가액 + 판 돈 − 매도 수수료·세금) / 넣은 돈, 계속 들고 있었다면 = 산 주식을 하나도 안 팔았을 때
export function curve(trades: Trade[], bars: Bar[], bench: Bar[]): Curve | null {
  const ts = [...trades].sort((a, b) => a.day.localeCompare(b.day) || (a.side === b.side ? 0 : a.side === "buy" ? -1 : 1));
  const first = ts.find((t) => t.side === "buy");
  if (!first) return null;
  const rows = bars.filter((b) => b.day >= first.day);
  if (rows.length === 0) return null;
  const bm = new Map(bench.map((b) => [b.day, b.close]));
  let k = 0, invested = 0, cash = 0, held = 0, bought = 0, benchBase: number | null = null, benchLast: number | null = null;
  const out: Curve = { days: [], closes: [], mine: [], held: [], bench: [] };
  for (const b of rows) {
    while (k < ts.length && ts[k].day <= b.day) {
      const t = ts[k++];
      if (t.side === "buy") { invested += t.quantity * t.price + (t.fee ?? 0); held += t.quantity; bought += t.quantity; }
      else { cash += t.quantity * t.price - (t.fee ?? 0); held -= t.quantity; }
    }
    if (bm.has(b.day)) benchLast = bm.get(b.day)!;
    if (benchBase === null && benchLast !== null) benchBase = benchLast;
    out.days.push(b.day);
    out.closes.push(b.close);
    out.mine.push(invested ? ((Math.max(0, held) * b.close + cash) / invested - 1) * 100 : 0);
    out.held.push(invested ? ((bought * b.close) / invested - 1) * 100 : 0);
    out.bench.push(benchBase !== null && benchLast !== null ? (benchLast / benchBase - 1) * 100 : null);
  }
  return out;
}

export type After = { pct: number; days: number }; // days: 실제로 지난 거래일 수
// 판 뒤: 판 값 대비 n거래일 뒤 종가. 아직 n일이 안 지났으면 지금까지
export function afterSell(bars: Bar[], day: string, price: number, n = AFTER_DAYS): After | null {
  const later = bars.filter((b) => b.day > day);
  if (later.length === 0 || price <= 0) return null;
  const b = later[Math.min(n, later.length) - 1];
  return { pct: (b.close / price - 1) * 100, days: Math.min(n, later.length) };
}

export type Verdict = "early" | "good" | "even";
export const VERDICT: Record<Verdict, string> = { early: "일찍 팜", good: "잘 팜", even: "비슷" };
export function verdict(a: After): Verdict {
  return a.pct > 5 ? "early" : a.pct < -3 ? "good" : "even";
}

// 산 뒤: 산 날 다음부터 (다 판 날 또는 오늘)까지 가장 많이 빠졌을 때·가장 많이 올랐을 때(산 값 대비 %)
export function afterBuy(bars: Bar[], day: string, until: string | null, price: number): { down: number; up: number } | null {
  const span = bars.filter((b) => b.day > day && (until === null || b.day <= until));
  if (span.length === 0 || price <= 0) return null;
  const lo = Math.min(...span.map((b) => b.low ?? b.close)), hi = Math.max(...span.map((b) => b.high ?? b.close));
  return { down: Math.min(0, (lo / price - 1) * 100), up: Math.max(0, (hi / price - 1) * 100) };
}
