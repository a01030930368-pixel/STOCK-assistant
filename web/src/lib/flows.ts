// 투자자별 수급: 키움 순매수 금액(백만원)을 억 단위로 보고, 누적·연속 일수를 셉니다.

export type FlowRow = { day: string; close: number; foreign: number; institution: number; individual: number };
export type Who = "foreign" | "institution" | "individual";
export const WHO: { key: Who; label: string; color: string }[] = [
  { key: "foreign", label: "외국인", color: "#c98500" },
  { key: "institution", label: "기관", color: "#199e70" },
  { key: "individual", label: "개인", color: "#9085e9" },
];

// 백만원 → 억
export const eok = (million: number) => million / 100;
export function money(million: number): string {
  const v = eok(million);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 10000) return `${sign}${(a / 10000).toFixed(1)}조`;
  return `${sign}${a >= 10 ? Math.round(a).toLocaleString("ko-KR") : a.toFixed(1)}억`;
}

export function cumulative(rows: FlowRow[], who: Who): number[] {
  let s = 0;
  return rows.map((r) => (s += r[who]));
}

export const total = (rows: FlowRow[], who: Who) => rows.reduce((s, r) => s + r[who], 0);

// 가장 최근 날부터 같은 방향(순매수/순매도)으로 며칠 이어졌는지. 0이면 0.
export function streak(rows: FlowRow[], who: Who): number {
  let n = 0, dir = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const d = Math.sign(rows[i][who]);
    if (d === 0) break;
    if (dir === 0) dir = d;
    if (d !== dir) break;
    n += dir;
  }
  return n;
}

export function streakText(n: number): string {
  if (n >= 2) return `${n}일 연속 순매수`;
  if (n <= -2) return `${-n}일 연속 순매도`;
  return n === 1 ? "오늘 순매수" : n === -1 ? "오늘 순매도" : "";
}
