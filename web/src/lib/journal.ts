// 매매일지 계산과 검증. DB와 무관한 순수 함수라 테스트하기 쉽게 분리했습니다.

export type BuyInput = {
  tradeDate: string;
  ticker: string;
  name: string;
  market: "KR" | "US";
  quantity: number;
  price: number;
  reason: string;
  scenario: string;
  risks: [string, string, string];
  weightPct: number;
  stopPrice: number;
  targetPrice: number;
  targetBasis: "chart" | "percent";
};

export type Fill = { tradeDate: string; quantity: number; price: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 매수 전 체크리스트를 통과해야만 저장됩니다. 빈 배열이면 통과.
export function validateBuy(input: BuyInput): string[] {
  const errors: string[] = [];
  if (!DATE_RE.test(input.tradeDate)) errors.push("매수일을 입력하세요.");
  if (!input.ticker.trim() || !input.name.trim()) errors.push("종목명과 티커를 입력하세요.");
  if (!(input.quantity > 0) || !(input.price > 0)) errors.push("수량과 매수가는 0보다 커야 합니다.");
  const reason = input.reason.trim();
  if (!reason) errors.push("1. 왜 사는지 한 문장으로 적어야 합니다.");
  else if (/[.!?。]\s*\S/.test(reason) || reason.includes("\n")) errors.push("1. 매수 이유는 한 문장이어야 합니다.");
  if (input.risks.some((r) => !r.trim())) errors.push("2. 가장 큰 리스크 3가지를 모두 적어야 합니다.");
  if (!(input.weightPct > 0 && input.weightPct <= 100)) errors.push("3. 비중은 0%보다 크고 100% 이하여야 합니다.");
  if (!(input.stopPrice > 0 && input.stopPrice < input.price)) errors.push("4. 손절 라인은 매수가보다 낮아야 합니다.");
  if (!(input.targetPrice > input.price)) errors.push("5. 익절 목표가는 매수가보다 높아야 합니다.");
  return errors;
}

export function averagePrice(fills: Fill[]): number {
  const qty = fills.reduce((s, f) => s + f.quantity, 0);
  if (qty === 0) return 0;
  return fills.reduce((s, f) => s + f.quantity * f.price, 0) / qty;
}

export function returnPct(avgBuy: number, sellPrice: number): number {
  return Math.round(((sellPrice - avgBuy) / avgBuy) * 10000) / 100;
}

export function holdingDays(buys: Fill[], sellDate: string): number {
  const first = buys.map((b) => b.tradeDate).sort()[0];
  if (!first) return 0;
  return Math.round((Date.parse(sellDate) - Date.parse(first)) / 86_400_000);
}

// 소수점 주식(0.1 + 0.2 같은)도 다 팔면 0이 되도록 소수 6자리에서 반올림합니다.
export function remainingQuantity(buys: Fill[], sells: Fill[]): number {
  const sum = (xs: Fill[]) => xs.reduce((s, f) => s + f.quantity, 0);
  return Math.round((sum(buys) - sum(sells)) * 1e6) / 1e6;
}

export const sameQuantity = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// 매도 때의 평단: 그날까지 산 것들의 평균. 그 전 매수가 없으면 전체 평균입니다.
export function averageBefore(buys: Fill[], sellDate: string): number {
  const before = buys.filter((b) => b.tradeDate <= sellDate);
  return averagePrice(before.length ? before : buys);
}

// 티커 모양으로 시장을 정합니다. 영문만(BRK.B 같은 점·하이픈 포함)이면 미국, 숫자로 시작하면 국내.
// 국내 ETN(Q530036)처럼 섞인 건 고른 값을 따라요. 미국 종목을 국내로 잘못 골라 일기장이 갈라지던 것을 막습니다.
export function marketOf(ticker: string, chosen: "KR" | "US"): "KR" | "US" {
  const t = ticker.trim().toUpperCase();
  if (/^[A-Z]+([.-][A-Z]+)?$/.test(t)) return "US";
  if (/^\d/.test(t)) return "KR";
  return chosen;
}
