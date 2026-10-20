// 매매일지 통계. 매도 기록 하나를 매매 한 번으로 셉니다. DB와 무관한 순수 함수입니다.

export type Sale = {
  tradeDate: string; // YYYY-MM-DD
  ticker: string;
  name: string;
  returnPct: number;
  holdingDays: number;
  reasonType: "stop" | "target" | "other";
  followedRules: boolean;
  lesson: string;
};

export type Summary = {
  count: number;
  wins: number;
  winRate: number | null; // %
  avgWin: number | null; // %
  avgLoss: number | null; // % (음수)
  payoff: number | null; // 평균 수익 ÷ |평균 손실|
  avgReturn: number | null;
  avgDays: number | null;
  avgDaysWin: number | null;
  avgDaysLoss: number | null;
  worst: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round = (x: number | null, d = 2) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function summarize(sales: Sale[]): Summary {
  const wins = sales.filter((s) => s.returnPct > 0);
  const losses = sales.filter((s) => s.returnPct <= 0);
  const avgWin = mean(wins.map((s) => s.returnPct));
  const avgLoss = mean(losses.map((s) => s.returnPct));
  return {
    count: sales.length,
    wins: wins.length,
    winRate: sales.length ? round((wins.length / sales.length) * 100, 1) : null,
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    payoff: avgWin !== null && avgLoss ? round(avgWin / Math.abs(avgLoss)) : null,
    avgReturn: round(mean(sales.map((s) => s.returnPct))),
    avgDays: round(mean(sales.map((s) => s.holdingDays)), 0),
    avgDaysWin: round(mean(wins.map((s) => s.holdingDays)), 0),
    avgDaysLoss: round(mean(losses.map((s) => s.holdingDays)), 0),
    worst: sales.length ? Math.min(...sales.map((s) => s.returnPct)) : null,
  };
}

// 기간 필터. months가 null이면 전체.
export function since(sales: Sale[], today: string, months: number | null): Sale[] {
  if (months === null) return sales;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  const from = d.toISOString().slice(0, 10);
  return sales.filter((s) => s.tradeDate > from);
}

export function byRules(sales: Sale[]) {
  return { kept: summarize(sales.filter((s) => s.followedRules)), broken: summarize(sales.filter((s) => !s.followedRules)) };
}

export function byReason(sales: Sale[]) {
  const pick = (r: Sale["reasonType"]) => summarize(sales.filter((s) => s.reasonType === r));
  return { target: pick("target"), stop: pick("stop"), other: pick("other") };
}

// 월별 평균 수익률. 매도가 없는 달도 0건으로 채워 끊기지 않게 합니다.
export function monthly(sales: Sale[], today: string, months: number): { month: string; count: number; avgReturn: number | null }[] {
  const out = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const inMonth = sales.filter((s) => s.tradeDate.startsWith(key));
    out.push({ month: key, count: inMonth.length, avgReturn: round(mean(inMonth.map((s) => s.returnPct))) });
  }
  return out;
}
