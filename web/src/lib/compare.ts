// 두 종목 비교(최대 4종목): 같은 날 0%에서 출발한 수익률 선과 지표 한 줄씩 비교. DB와 무관한 순수 함수입니다.

export type Close = { day: string; close: number };
export const MAX = 4;
export const COLORS = ["#c9a96b", "#7fb8d6", "#a98fd6", "#6fbf9a"];
export const PERIODS = [
  { key: "1M", label: "1달", days: 31 },
  { key: "3M", label: "3달", days: 92 },
  { key: "6M", label: "6달", days: 183 },
  { key: "1Y", label: "1년", days: 365 },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export const daysBefore = (day: string, n: number) => new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);

// 주소의 ?t=000660,NVDA 를 종목 목록으로. 같은 종목·이상한 글자는 빼고 최대 4개.
export function parseTickers(raw: string | string[] | undefined): string[] {
  const s = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const out: string[] = [];
  for (const t of s.split(",").map((x) => x.trim().toUpperCase())) {
    if (/^[0-9A-Z.\-]{1,12}$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX);
}

// 여러 종목 종가를 from 날짜부터 같은 날짜 줄에 맞추고, 각자 첫 종가를 0%로 둔 수익률(%)로 바꿉니다.
// 한쪽만 쉬는 날(국내·미국 휴장이 다를 때)은 앞 종가를 이어 씁니다.
export function rebase(series: Close[][], from: string): { days: string[]; values: (number | null)[][] } {
  const days = [...new Set(series.flatMap((s) => s.filter((c) => c.day >= from).map((c) => c.day)))].sort();
  const values = series.map((s) => {
    const m = new Map(s.map((c) => [c.day, c.close]));
    let base: number | null = null, last: number | null = null;
    return days.map((d) => {
      const c = m.get(d);
      if (c !== undefined) last = c;
      if (last === null) return null;
      if (base === null) base = last;
      return (last / base - 1) * 100;
    });
  });
  return { days, values };
}

export type Metrics = {
  ret: number | null; per: number | null; pbr: number | null; dividend: number | null;
  growth: number | null; margin: number | null; debt: number | null; foreign20: number | null;
};
export type Row = { key: keyof Metrics; label: string; better: "high" | "low"; krOnly?: boolean };
export const ROWS: Row[] = [
  { key: "ret", label: "기간 수익률", better: "high" },
  { key: "per", label: "PER", better: "low" },
  { key: "pbr", label: "PBR", better: "low" },
  { key: "dividend", label: "배당수익률", better: "high" },
  { key: "growth", label: "매출 성장(1년)", better: "high" },
  { key: "margin", label: "영업이익률", better: "high" },
  { key: "debt", label: "부채비율", better: "low" },
  { key: "foreign20", label: "외국인 20일", better: "high", krOnly: true },
];

// 값이 둘 이상 있을 때 가장 나은 쪽의 자리. 같으면 표시하지 않아요. PER·PBR은 적자(0 이하)면 비교에서 빼요.
export function leader(values: (number | null)[], better: "high" | "low", positiveOnly = false): number | null {
  const ok = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null && (!positiveOnly || x.v > 0));
  if (ok.length < 2) return null;
  ok.sort((a, b) => (better === "high" ? b.v - a.v : a.v - b.v));
  return ok[0].v === ok[1].v ? null : ok[0].i;
}

// 매출 성장: 가장 최근 해와 그 전 해 매출 비교(%)
export function growthOf(rows: { period: string; revenue: number | null }[]): number | null {
  const s = rows.filter((r) => r.revenue !== null).sort((a, b) => b.period.localeCompare(a.period));
  if (s.length < 2 || !s[1].revenue || s[1].revenue <= 0) return null;
  return (s[0].revenue! / s[1].revenue - 1) * 100;
}

// 최근 1년 배당 합 / 지금 주가(%). 1년 안에 배당이 없으면 null
export function dividendYield(divs: { day: string; amount: number }[], price: number | null, today: string): number | null {
  if (!price || price <= 0) return null;
  const from = daysBefore(today, 365);
  const year = divs.filter((d) => d.day > from && d.day <= today);
  // 배당 기록이 아예 없으면(아직 안 받았거나 무배당) 0%가 아니라 빈칸으로 둬요.
  if (year.length === 0) return null;
  return (year.reduce((s, d) => s + d.amount, 0) / price) * 100;
}

// 가장 최근에 반영된 주당 값(밴드와 같은 기준)으로 지금 배수를 구해요. 적자·자본잠식이면 null
export function multiple(points: { from: string; value: number }[], price: number | null, today: string): number | null {
  const p = points.filter((x) => x.from <= today).at(-1);
  if (!p || !price || p.value <= 0) return null;
  return price / p.value;
}
