// PER·PBR 밴드: 주가 위에 "주당순이익(또는 주당순자산) × 몇 배" 선을 깔아 지금 주가가 예전보다 비싼지 싼지 봐요.
// 주당 값은 재무제표(stock_statements)를 지금 주식 수로 나눠요. 실적은 분기가 끝나고 45일(사업보고서는 이듬해 3월 말) 뒤부터 반영해요.
import { aggregate, type Candle } from "./candles";
import type { StatementRow } from "./statements";

export type BandKind = "per" | "pbr";
export type BandLine = { mult: number; values: (number | null)[] };
export type Band = {
  bars: Candle[];
  lines: BandLine[];
  current: number | null; // 지금 PER(배)
  low: number; high: number; // 밴드 아래·위 배수
  position: number | null; // 지난 기간 배수 중 지금보다 낮았던 비율(%)
  since: string | null; // 밴드를 그릴 수 있는 첫 주
};
export type Point = { from: string; value: number };

const QUARTER_END = ["03-31", "06-30", "09-30", "12-31"];
const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const quarterEnd = (p: string) => `${p.slice(0, 4)}-${QUARTER_END[Number(p.slice(5)) - 1]}`;
const prevQuarter = (p: string) => { const y = Number(p.slice(0, 4)), q = Number(p.slice(5)); return q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`; };

// 주당 값이 언제부터 얼마였나(오래된 것부터)
export function perShare(rows: StatementRow[], shares: number, kind: BandKind): Point[] {
  const item = kind === "per" ? "net_income" : "equity";
  const q = new Map(rows.filter((r) => r.kind === "Q" && r.item === item).map((r) => [r.period, r.value]));
  const quarterly: Point[] = [];
  for (const p of [...q.keys()].sort()) {
    let v: number | null = q.get(p)!;
    if (kind === "per") {
      // 최근 4분기 합. 중간에 빠진 분기가 있으면 건너뛰어요.
      let k = p;
      for (let n = 0; n < 3 && v !== null; n++) { k = prevQuarter(k); v = q.has(k) ? v + q.get(k)! : null; }
    }
    if (v !== null) quarterly.push({ from: addDays(quarterEnd(p), 45), value: v / shares });
  }
  const first = quarterly[0]?.from ?? "9999";
  const annual = rows.filter((r) => r.kind === "Y" && r.item === item)
    .map((r) => ({ from: `${Number(r.period) + 1}-03-31`, value: r.value / shares }))
    .filter((p) => p.from < first);
  return [...annual, ...quarterly].sort((a, b) => a.from.localeCompare(b.from));
}

function quantile(sorted: number[], p: number) {
  const i = (sorted.length - 1) * p;
  return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i - Math.floor(i));
}
const nice = (v: number) => (v >= 3 ? Math.round(v) : Math.round(v * 10) / 10);

export function buildBand(candles: Candle[], points: Point[], years: number | null, price: number | null): Band | null {
  let bars = aggregate(candles.map((c) => ({ ...c })), "W");
  if (years) {
    const from = addDays(candles.at(-1)?.day ?? "2000-01-01", -365 * years);
    bars = bars.filter((b) => b.day >= from);
  }
  let j = -1;
  const metric = bars.map((b) => {
    while (j + 1 < points.length && points[j + 1].from <= b.day) j++;
    return j >= 0 ? points[j].value : null;
  });
  const ratios = bars.map((b, i) => (metric[i] !== null && metric[i]! > 0 ? b.close / metric[i]! : null));
  const seen = ratios.filter((r): r is number => r !== null).sort((a, b) => a - b);
  if (seen.length < 8) return null;
  let low = nice(quantile(seen, 0.05)), high = nice(quantile(seen, 0.95));
  if (high <= low) high = nice(low * 1.5);
  const mults = [0, 1, 2, 3, 4].map((k) => nice(low + ((high - low) * k) / 4));
  const last = points.at(-1)?.value ?? null;
  const close = price ?? bars.at(-1)?.close ?? null;
  const current = last !== null && last > 0 && close !== null ? close / last : null;
  return {
    bars,
    lines: [...new Set(mults)].map((mult) => ({ mult, values: metric.map((m) => (m !== null && m > 0 ? m * mult : null)) })),
    current, low, high,
    position: current === null ? null : Math.round((seen.filter((r) => r <= current).length / seen.length) * 100),
    since: bars[ratios.findIndex((r) => r !== null)]?.day ?? null,
  };
}

// "지난 3년 PER의 68% 자리" 같은 한 줄
export function bandSentence(b: Band, kind: BandKind, years: number | null): string {
  const name = kind === "per" ? "PER" : "PBR";
  const span = years ? `지난 ${years}년` : "기록이 있는 기간";
  if (b.current === null) return "";
  const where = b.position! >= 80 ? "비싼 쪽이에요" : b.position! <= 20 ? "싼 쪽이에요" : "중간쯤이에요";
  return `${span} ${name}을 낮은 순으로 줄 세우면 지금은 ${b.position}% 자리예요. 그동안보다 ${where}.`;
}

export const times = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}배`;
