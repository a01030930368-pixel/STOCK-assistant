// 종목 검색기 조건 비교. 워커가 계산한 지표(screener_stocks)를 저장한 조건(screener_presets.rules)과 맞춰 봅니다.
export type Rules = {
  minValueEok?: number | null; // 거래대금(억 원) 이상
  chgMin?: number | null; // 등락률(%) 이상
  chgMax?: number | null; // 등락률(%) 이하
  volRatioMin?: number | null; // 거래량이 20일 평균의 몇 배 이상
  rsiMin?: number | null;
  rsiMax?: number | null;
  ma20?: "above" | "below" | null; // 20일 이동평균선 위·아래
  goldenCross?: boolean | null; // 최근 3거래일 안에 5일선이 20일선을 뚫음
  nearHighPct?: number | null; // 52주 최고가에서 몇 % 이내
};

export type ScreenStock = {
  ticker: string; name: string; price: number; changePct: number | null; tradeValue: number;
  volumeRatio: number | null; rsi14: number | null; ma20GapPct: number | null; goldenCross: boolean;
  nearHighPct: number; spark: number[];
};

const set = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const eok = (won: number) => won / 1e8;
const n1 = (v: number) => (Number.isInteger(v) ? v.toLocaleString("ko-KR") : v.toFixed(1));

// 조건마다 [맞는지, 결과에 붙일 이름]을 돌려줍니다. 값이 없는 지표는 맞지 않는 것으로 봅니다.
function checks(s: ScreenStock, r: Rules): [boolean, string][] {
  const out: [boolean, string][] = [];
  if (set(r.minValueEok)) out.push([eok(s.tradeValue) >= r.minValueEok, "거래대금"]);
  if (set(r.chgMin) || set(r.chgMax)) {
    const c = s.changePct;
    out.push([c !== null && (!set(r.chgMin) || c >= r.chgMin) && (!set(r.chgMax) || c <= r.chgMax), "등락률"]);
  }
  if (set(r.volRatioMin)) out.push([s.volumeRatio !== null && s.volumeRatio >= r.volRatioMin, `거래량 ${s.volumeRatio?.toFixed(1)}배`]);
  if (set(r.rsiMin) || set(r.rsiMax)) {
    const v = s.rsi14;
    out.push([v !== null && (!set(r.rsiMin) || v >= r.rsiMin) && (!set(r.rsiMax) || v <= r.rsiMax), `RSI ${v?.toFixed(0)}`]);
  }
  if (r.ma20) {
    const g = s.ma20GapPct;
    out.push([g !== null && (r.ma20 === "above" ? g > 0 : g < 0), r.ma20 === "above" ? "20일선 위" : "20일선 아래"]);
  }
  if (r.goldenCross) out.push([s.goldenCross, "골든크로스"]);
  if (set(r.nearHighPct)) out.push([s.nearHighPct >= -r.nearHighPct, s.nearHighPct >= -0.05 ? "52주 신고가" : `신고가 ${s.nearHighPct.toFixed(1)}%`]);
  return out;
}

export function matches(s: ScreenStock, r: Rules): boolean {
  const c = checks(s, r);
  return c.length > 0 && c.every(([ok]) => ok);
}

export function reasons(s: ScreenStock, r: Rules): string[] {
  return checks(s, r).filter(([ok]) => ok).map(([, label]) => label);
}

export function screen(stocks: ScreenStock[], r: Rules): ScreenStock[] {
  return stocks.filter((s) => matches(s, r)).sort((a, b) => b.tradeValue - a.tradeValue);
}

export function describe(r: Rules): string {
  const p: string[] = [];
  if (set(r.minValueEok)) p.push(`거래대금 ${n1(r.minValueEok)}억↑`);
  if (set(r.chgMin) && set(r.chgMax)) p.push(`등락률 ${n1(r.chgMin)}~${n1(r.chgMax)}%`);
  else if (set(r.chgMin)) p.push(`등락률 ${n1(r.chgMin)}%↑`);
  else if (set(r.chgMax)) p.push(`등락률 ${n1(r.chgMax)}%↓`);
  if (set(r.volRatioMin)) p.push(`거래량 ${n1(r.volRatioMin)}배↑`);
  if (set(r.rsiMin) && set(r.rsiMax)) p.push(`RSI ${n1(r.rsiMin)}~${n1(r.rsiMax)}`);
  else if (set(r.rsiMax)) p.push(`RSI ${n1(r.rsiMax)}↓`);
  else if (set(r.rsiMin)) p.push(`RSI ${n1(r.rsiMin)}↑`);
  if (r.ma20) p.push(r.ma20 === "above" ? "20일선 위" : "20일선 아래");
  if (r.goldenCross) p.push("5일선이 20일선 위로");
  if (set(r.nearHighPct)) p.push(`52주 최고가 ${n1(r.nearHighPct)}% 이내`);
  return p.length ? p.join(" · ") : "조건 없음";
}

// 폼 입력을 조건으로 바꿉니다. 빈칸은 조건에서 뺍니다.
export function rulesFromForm(get: (key: string) => string): Rules {
  const num = (k: string) => {
    const t = get(k).replace(/,/g, "").trim();
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };
  const ma = get("ma20");
  const r: Rules = {
    minValueEok: num("minValueEok"), chgMin: num("chgMin"), chgMax: num("chgMax"), volRatioMin: num("volRatioMin"),
    rsiMin: num("rsiMin"), rsiMax: num("rsiMax"), ma20: ma === "above" || ma === "below" ? ma : null,
    goldenCross: get("goldenCross") === "on" ? true : null, nearHighPct: num("nearHighPct"),
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) as Rules;
}
