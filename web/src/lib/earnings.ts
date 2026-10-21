// 종목 페이지 "실적" 칸: 워커가 earnings_reports에 넣은 실적 정리(국내 원, 미국 달러)를 보여 줘요.
import { money, quarterLabel } from "./statements";

export type Line = { cur: number | null; prev: number | null; yoy: number | null };
export type ReportData = {
  unit: "KRW" | "USD";
  lines: Partial<Record<"revenue" | "operating_income" | "net_income", Line>>;
  eps: { actual: number | null; estimate: number | null } | null;
  revenue_estimate: number | null;
  history: { period: string; revenue: number | null; operating_income: number | null }[];
  surprises: { period: string; eps_pct: number | null; revenue_pct: number | null }[];
  preliminary: boolean;
};
export type Report = { period: string; reported_on: string; url: string; market: string; data: ReportData; ai: string };

export const ITEMS = [["revenue", "매출액"], ["operating_income", "영업이익"], ["net_income", "순이익"]] as const;

// 비교 글과 색: +19% / −5% / 흑자 전환 / 적자 전환 / 적자 지속
export function change(cur: number | null, base: number | null | undefined): { text: string; tone: "up" | "down" | "" } | null {
  if (cur === null || base === null || base === undefined) return null;
  if (base > 0 && cur > 0) {
    const p = (cur / base - 1) * 100;
    return { text: `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p))}%`, tone: p >= 0 ? "up" : "down" };
  }
  if (base <= 0 && cur > 0) return { text: "흑자 전환", tone: "up" };
  if (base > 0 && cur <= 0) return { text: "적자 전환", tone: "down" };
  return { text: "적자 지속", tone: "" };
}

export function margin(d: ReportData, key: keyof Line): number | null {
  const op = d.lines.operating_income?.[key] ?? null;
  const rev = d.lines.revenue?.[key] ?? null;
  return op !== null && rev ? (op / rev) * 100 : null;
}

// 예상 대비 몇 % (예상이 음수면 덜 나쁠수록 +)
export function surprise(actual: number | null | undefined, estimate: number | null | undefined): number | null {
  if (actual === null || actual === undefined || !estimate) return null;
  return (actual / estimate - 1) * 100 * (estimate > 0 ? 1 : -1);
}

// 예상 대비 막대 위 점 위치(가운데 50%가 예상, ±9% 넘으면 끝에 붙어요)
export const gaugePos = (pct: number) => 50 + Math.max(-45, Math.min(45, pct * 5));

export function title(r: Pick<Report, "period" | "market">): string {
  const q = r.period.slice(5);
  return r.market === "KR" ? `${q}분기 잠정 실적` : `${q}분기 실적 · 회계연도 ${r.period.slice(2, 4)}년`;
}

export { money, quarterLabel };
