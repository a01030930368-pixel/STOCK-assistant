// 수익 달력: 날마다 내 돈 전체(원화 환산)가 전날 기록보다 얼마나 변했는지. DB와 무관한 순수 함수입니다.

export type AssetRow = { day: string; total: number };
export type DayChange = { day: string; total: number; change: number | null; pct: number | null };

// 기록이 있는 날마다 바로 앞 기록과 비교합니다. 맨 처음 기록은 비교할 게 없어 change가 null이에요.
export function dailyChanges(rows: AssetRow[]): Map<string, DayChange> {
  const out = new Map<string, DayChange>();
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : 1));
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    const change = prev ? r.total - prev.total : null;
    out.set(r.day, { day: r.day, total: r.total, change, pct: prev && prev.total > 0 ? Math.round((change! / prev.total) * 10000) / 100 : null });
  });
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const monthOf = (day: string) => day.slice(0, 7);
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// 일요일부터 시작하는 달력 칸. 1일 앞의 빈칸은 null이에요.
export function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
}

export type MonthSummary = { change: number | null; pct: number | null; ups: number; downs: number; from: string | null };

// 이번 달 변화: 이번 달 마지막 기록 − 지난달 마지막 기록. 지난달 기록이 없으면 이번 달 첫 기록부터(from에 그날).
export function monthSummary(rows: AssetRow[], changes: Map<string, DayChange>, month: string): MonthSummary {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : 1));
  const inMonth = sorted.filter((r) => monthOf(r.day) === month);
  const before = sorted.filter((r) => monthOf(r.day) < month).at(-1);
  const last = inMonth.at(-1);
  const base = before ?? inMonth[0];
  let ups = 0, downs = 0;
  for (const r of inMonth) {
    const c = changes.get(r.day)?.change;
    if (c && c > 0) ups += 1;
    else if (c && c < 0) downs += 1;
  }
  if (!last || !base) return { change: null, pct: null, ups, downs, from: null };
  const change = last.total - base.total;
  return { change, pct: base.total > 0 ? Math.round((change / base.total) * 10000) / 100 : null, ups, downs, from: before ? null : base.day };
}

// 칸 색: 오르면 빨강, 내리면 파랑. 2.5% 넘게 움직이면 가장 진해요.
export function cellColor(pct: number | null): string | undefined {
  if (pct === null || pct === 0) return undefined;
  const k = Math.min(1, Math.abs(pct) / 2.5);
  const [r, g, b] = pct > 0 ? [232, 128, 111] : [134, 168, 230];
  return `rgba(${r}, ${g}, ${b}, ${(0.14 + 0.62 * k).toFixed(2)})`;
}

// 12.3만 / 1,234만 / 8,500 처럼 달력 칸에 들어갈 짧은 원 단위
export function shortWon(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: a >= 1e6 ? 0 : 1 })}만`;
  return `${sign}${Math.round(a).toLocaleString("ko-KR")}`;
}
