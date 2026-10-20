// ISA 계좌 숫자 계산. 한도는 2026년 기준(연 납입 2,000만원, 의무 가입 3년, 비과세 일반형 200만원·서민형 400만원).
export const YEAR_LIMIT = 20_000_000;
export const MIN_YEARS = 3;
export type IsaType = "general" | "low";
export const TYPE_LABEL: Record<IsaType, string> = { general: "일반형", low: "서민·농어민형" };
export const TAX_FREE: Record<IsaType, number> = { general: 2_000_000, low: 4_000_000 };
export type IsaSettings = { type: IsaType; opened: string | null };

export function settingsOf(raw: unknown): IsaSettings {
  const v = (raw ?? {}) as { type?: unknown; opened?: unknown };
  const opened = typeof v.opened === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.opened) ? v.opened : null;
  return { type: v.type === "low" ? "low" : "general", opened };
}

// 의무 가입 기간이 끝나는 날(개설일 + 3년)과 오늘부터 남은 날
export function maturity(opened: string, today: string): { day: string; daysLeft: number } {
  const [y, m, d] = opened.split("-").map(Number);
  const end = new Date(Date.UTC(y + MIN_YEARS, m - 1, d));
  const day = end.toISOString().slice(0, 10);
  const [ty, tm, td] = today.split("-").map(Number);
  const daysLeft = Math.round((end.getTime() - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  return { day, daysLeft: Math.max(0, daysLeft) };
}

// 지금 평가이익이 비과세 한도의 몇 %인지, 넘은 금액은 얼마인지
export function taxFree(pnl: number, type: IsaType) {
  const limit = TAX_FREE[type];
  const gain = Math.max(0, pnl);
  return { limit, gain, pct: Math.min(100, (gain / limit) * 100), over: Math.max(0, gain - limit) };
}

export const yearPct = (bought: number) => Math.min(100, (Math.max(0, bought) / YEAR_LIMIT) * 100);
