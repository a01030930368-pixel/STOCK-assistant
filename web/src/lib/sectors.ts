// 섹터 동향: 기간별 등락, 내 종목이 있는 섹터, 네모 지도 배치.

export type Period = "d1" | "w1" | "m1" | "m3" | "ytd";
export const PERIODS: { key: Period; label: string; short: string }[] = [
  { key: "d1", label: "오늘", short: "오늘" }, { key: "w1", label: "1주", short: "1주" }, { key: "m1", label: "1달", short: "1달" },
  { key: "m3", label: "3달", short: "3달" }, { key: "ytd", label: "올해", short: "올해" },
];

export type Close = { day: string; close: number };
export type Mine = { count: number; pct: number; names: string[] };
export type SectorRow = {
  code: string; name: string; weight: number | null; leaders: { name: string; pct: number }[];
  ret: Record<Period, number | null>; mine: Mine | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, months: number, days = 0) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return iso(d);
};

// 그날(또는 그 전 가장 가까운 거래일) 종가. closes는 날짜 오름차순.
export function closeOn(closes: Close[], day: string): number | null {
  let found: number | null = null;
  for (const c of closes) {
    if (c.day > day) break;
    found = c.close;
  }
  return found;
}

const pct = (now: number, then: number | null) => (then && then > 0 ? Math.round((now / then - 1) * 1000) / 10 : null);

// 지금 지수와 지난 종가로 기간별 등락(%)을 만들어요. 오늘 등락은 받아 온 값을 그대로 써요.
export function returns(price: number, today: number, closes: Close[], asOf: string): Record<Period, number | null> {
  // 마지막 종가가 오늘 값이면 기준일을 그 날짜로 잡아요(장이 닫힌 날에도 "1주 전"이 어긋나지 않게).
  const last = closes.length ? closes[closes.length - 1].day : asOf;
  const base = last < asOf ? last : asOf;
  const yearEnd = `${Number(base.slice(0, 4)) - 1}-12-31`;
  const first = closes[0]?.day;
  const ref = (day: string) => (first && day >= first ? closeOn(closes, day) : null);
  return {
    d1: Math.round(today * 10) / 10,
    w1: pct(price, ref(shift(base, 0, 7))),
    m1: pct(price, ref(shift(base, 1))),
    m3: pct(price, ref(shift(base, 3))),
    ytd: pct(price, ref(yearEnd)),
  };
}

// 업종 이름은 출처마다 "전기·전자", "전기전자", "전기 전자"처럼 달라서 글자만 남겨 비교해요.
export const norm = (s: string) => s.replace(/[^가-힣A-Za-z0-9]/g, "").replace(/업$/, "");

// 미국 종목 업종(Finnhub 업종을 한국어로 바꾼 것)을 S&P 500 섹터로 묶어요. 대략적인 분류예요.
const US_GROUP: Record<string, string> = {
  기술: "XLK", 반도체: "XLK", 소프트웨어: "XLK", Technology: "XLK", Semiconductors: "XLK",
  미디어: "XLC", 통신: "XLC", Media: "XLC", "Interactive Media & Services": "XLC",
  자동차: "XLY", 유통: "XLY", "호텔·레저": "XLY", 소비재: "XLY", Retail: "XLY", "Textiles, Apparel & Luxury Goods": "XLY",
  은행: "XLF", 금융: "XLF", 보험: "XLF", Banking: "XLF",
  제약: "XLV", 바이오: "XLV", 헬스케어: "XLV", Biotechnology: "XLV", "Life Sciences Tools & Services": "XLV",
  "항공·방산": "XLI", 기계: "XLI", 전기장비: "XLI", 항공: "XLI", 운송: "XLI", 건설: "XLI", "Commercial Services & Supplies": "XLI",
  음료: "XLP", 식품: "XLP", Tobacco: "XLP",
  에너지: "XLE", 유틸리티: "XLU", 부동산: "XLRE", 화학: "XLB", "금속·광업": "XLB",
};
export const usSector = (sector: string) => US_GROUP[sector.trim()] ?? null;

export type HoldingIn = { name: string; sector: string | null; amount: number; pnlPct: number };

// 섹터마다 내 종목 수·비중(그 시장 보유 평가액 중 %)·이름. 업종을 모르는 종목은 셈에서 빠져요.
export function mine(market: "KR" | "US", sectors: { code: string; name: string }[], holdings: HoldingIn[]): Map<string, Mine> {
  const total = holdings.reduce((s, h) => s + h.amount, 0);
  const byName = new Map(sectors.map((s) => [norm(s.name), s.code]));
  const out = new Map<string, Mine>();
  for (const h of holdings) {
    if (!h.sector) continue;
    const code = market === "US" ? usSector(h.sector) : byName.get(norm(h.sector)) ?? null;
    if (!code) continue;
    const m = out.get(code) ?? { count: 0, pct: 0, names: [] };
    m.count += 1;
    m.pct += total > 0 ? (h.amount / total) * 100 : 0;
    m.names.push(h.name);
    out.set(code, m);
  }
  for (const m of out.values()) m.pct = Math.round(m.pct);
  return out;
}

// 네모 지도: 무게 순으로 줄 세워 절반씩 나누는 방식(가로가 길면 세로로, 세로가 길면 가로로 잘라요).
export type Box<T> = { item: T; x: number; y: number; w: number; h: number };
export function treemap<T>(items: { weight: number; item: T }[], x: number, y: number, w: number, h: number): Box<T>[] {
  const list = items.filter((i) => i.weight > 0).sort((a, b) => b.weight - a.weight);
  const out: Box<T>[] = [];
  const split = (part: typeof list, x: number, y: number, w: number, h: number) => {
    if (!part.length) return;
    if (part.length === 1) { out.push({ item: part[0].item, x, y, w, h }); return; }
    const total = part.reduce((s, i) => s + i.weight, 0);
    let acc = 0, k = 0;
    while (k < part.length - 1 && acc + part[k].weight <= total / 2) acc += part[k++].weight;
    k = Math.max(k, 1);
    acc = part.slice(0, k).reduce((s, i) => s + i.weight, 0);
    const f = acc / total;
    if (w >= h) { split(part.slice(0, k), x, y, w * f, h); split(part.slice(k), x + w * f, y, w * (1 - f), h); }
    else { split(part.slice(0, k), x, y, w, h * f); split(part.slice(k), x, y + h * f, w, h * (1 - f)); }
  };
  split(list, x, y, w, h);
  return out;
}

export const signed = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);

// 칸 색: 오르면 빨강, 내리면 파랑. 기간이 길수록 같은 색이 되려면 더 많이 움직여야 해요.
export const SCALE: Record<Period, number> = { d1: 3, w1: 6, m1: 10, m3: 20, ytd: 40 };
export function heat(v: number | null, period: Period): string | undefined {
  if (v === null || v === 0) return undefined;
  const a = Math.min(1, Math.abs(v) / SCALE[period]) * 0.55 + 0.06;
  return v > 0 ? `rgba(232, 128, 111, ${a.toFixed(2)})` : `rgba(134, 168, 230, ${a.toFixed(2)})`;
}
