export type FinancialRow = {
  ticker: string; period: string; revenue: string | null; operating_income: string | null;
  liabilities: string | null; equity: string | null; operating_cash_flow: string | null;
};

const n = (v: string | null) => (v === null ? null : Number(v));

// 영업이익률(%) = 영업이익 / 매출
export function operatingMargin(f: FinancialRow): number | null {
  const rev = n(f.revenue), op = n(f.operating_income);
  if (rev === null || op === null || rev === 0) return null;
  return Math.round((op / rev) * 1000) / 10;
}

// 부채비율(%) = 부채 / 자본
export function debtRatio(f: FinancialRow): number | null {
  const liab = n(f.liabilities), eq = n(f.equity);
  if (liab === null || eq === null || eq <= 0) return null;
  return Math.round((liab / eq) * 1000) / 10;
}

export function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

// 큰 금액을 읽기 쉽게: 국내 1.2조원 / 3,400억원, 미국 $416.2B / $850.0M
export function bigMoney(value: string | null, market: string): string {
  if (value === null) return "-";
  const v = Number(value);
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (market === "US") {
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
    return `${sign}$${a.toLocaleString("en-US")}`;
  }
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(1)}조원`;
  if (a >= 1e8) return `${sign}${Math.round(a / 1e8).toLocaleString("ko-KR")}억원`;
  return `${sign}${a.toLocaleString("ko-KR")}원`;
}
