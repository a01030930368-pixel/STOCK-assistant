// 포트폴리오 비중. 미국 종목과 달러 예수금은 환율로 원화로 바꿔 합칩니다. ISA는 원화 계좌라 그대로 더해요.

export type HoldingIn = { ticker: string; name: string; market: "KR" | "US" | "ISA"; evalAmount: number; pnlPct: number; sector: string | null };
export type Part = { key: string; label: string; amount: number; pct: number };
export type StockPart = Part & { market: "KR" | "US" | "ISA" | "CASH"; sector: string; pnlPct: number | null; etf?: boolean };

export const CASH = "현금";
export const UNKNOWN = "업종 미확인";

// 국내 상장 ETF는 운용사 브랜드로 시작해요. ETF는 여러 종목 묶음이라 한 종목 한도에서 빼고, 업종을 모르면 "ETF"로 묶어요.
export const ETF = "ETF";
const ETF_BRAND = /^(KODEX|TIGER|ACE|RISE|KBSTAR|SOL|HANARO|PLUS|KOSEF|ARIRANG|TIMEFOLIO|KIWOOM|WON|BNK|1Q|HK|UNICORN|TRUSTON|마이다스|파워|에셋플러스|히어로즈|VITA|DAISHIN343|FOCUS|TREX|KoAct|ITF|마이티)\s/i;
export const isEtf = (name: string) => ETF_BRAND.test(name.trim());

const pct = (x: number, total: number) => (total > 0 ? Math.round((x / total) * 1000) / 10 : 0);

export function weights(holdings: HoldingIn[], usdKrw: number, cashKrw: number, cashUsd: number) {
  const krw = (h: HoldingIn) => (h.market === "US" ? h.evalAmount * usdKrw : h.evalAmount);
  const cash = cashKrw + cashUsd * usdKrw;
  const total = holdings.reduce((s, h) => s + krw(h), 0) + cash;
  const stocks: StockPart[] = holdings
    .map((h) => ({ key: h.market === "ISA" ? `ISA:${h.ticker}` : h.ticker, label: h.market === "ISA" ? `${h.name} (ISA)` : h.name, amount: krw(h), pct: pct(krw(h), total), market: h.market, sector: h.sector || (isEtf(h.name) ? ETF : UNKNOWN), pnlPct: h.pnlPct, etf: isEtf(h.name) }))
    .sort((a, b) => b.amount - a.amount);
  if (cash > 0) stocks.push({ key: CASH, label: CASH, amount: cash, pct: pct(cash, total), market: "CASH", sector: CASH, pnlPct: null });

  const group = (keyOf: (s: StockPart) => string, labelOf: (k: string) => string = (k) => k): Part[] => {
    const sums = new Map<string, number>();
    for (const s of stocks) sums.set(keyOf(s), (sums.get(keyOf(s)) ?? 0) + s.amount);
    return [...sums].map(([key, amount]) => ({ key, label: labelOf(key), amount, pct: pct(amount, total) })).sort((a, b) => b.amount - a.amount);
  };
  const MARKET: Record<string, string> = { KR: "국내", US: "해외", ISA: "ISA", CASH };
  return { total, stocks, sectors: group((s) => s.sector), markets: group((s) => s.market, (k) => MARKET[k]) };
}

export type Limits = { sectorMax: number; stockMax: number; cashMin: number };

// 한도를 넘은 항목을 문장으로 돌려줍니다. 비어 있으면 괜찮은 상태입니다.
export function breaches(w: ReturnType<typeof weights>, limits: Limits): string[] {
  const out: string[] = [];
  for (const s of w.sectors) if (s.key !== CASH && s.key !== UNKNOWN && s.key !== ETF && s.pct > limits.sectorMax) out.push(`${s.label} 업종이 ${s.pct}%로 한도 ${limits.sectorMax}%를 넘었어요.`);
  for (const s of w.stocks) if (s.market !== "CASH" && !s.etf && s.pct > limits.stockMax) out.push(`${s.label} 비중이 ${s.pct}%로 한 종목 한도 ${limits.stockMax}%를 넘었어요.`);
  const cash = w.stocks.find((s) => s.market === "CASH")?.pct ?? 0;
  if (w.total > 0 && cash < limits.cashMin) out.push(`현금이 ${cash}%로 최소 ${limits.cashMin}%보다 적어요.`);
  return out;
}
