// 차트 보조지표: MACD, 스토캐스틱, OBV, 일목균형표, VWAP, 매물대, 캔들 패턴, RSI 다이버전스.
// 값이 아직 없는 앞부분(기간보다 봉이 적을 때)은 null이에요.
import { sma } from "./candles";

export type Ohlcv = { open: number; high: number; low: number; close: number; volume: number | null };

// 지수 이동평균. 처음 n개의 단순 평균에서 시작해요.
export function ema(values: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  const m = 2 / (n + 1);
  let prev: number | null = null, seed: number[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    if (prev === null) {
      seed.push(v);
      if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; seed = []; }
      return;
    }
    prev = prev + m * (v - prev);
    out[i] = prev;
  });
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9): ({ macd: number; signal: number; hist: number } | null)[] {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] === null || s[i] === null ? null : f[i]! - s[i]!));
  const sig = ema(line, signal);
  return line.map((v, i) => (v === null || sig[i] === null ? null : { macd: v, signal: sig[i]!, hist: v - sig[i]! }));
}

// 느린 스토캐스틱: %K = 최근 k개 봉 안에서 종가 위치를 d개로 평균, %D = %K를 다시 d개로 평균
export function stochastic(bars: Ohlcv[], k = 14, d = 3): ({ k: number; d: number } | null)[] {
  const raw = bars.map((_, i) => {
    if (i < k - 1) return null;
    const w = bars.slice(i - k + 1, i + 1);
    const hi = Math.max(...w.map((b) => b.high)), lo = Math.min(...w.map((b) => b.low));
    return hi > lo ? ((bars[i].close - lo) / (hi - lo)) * 100 : 50;
  });
  const avg = (a: (number | null)[]) => {
    const out: (number | null)[] = a.map(() => null);
    for (let i = 0; i < a.length; i++) {
      const w = a.slice(Math.max(0, i - d + 1), i + 1);
      if (w.length === d && w.every((x) => x !== null)) out[i] = (w as number[]).reduce((s, x) => s + x, 0) / d;
    }
    return out;
  };
  const K = avg(raw), D = avg(K);
  return K.map((v, i) => (v === null || D[i] === null ? null : { k: v, d: D[i]! }));
}

// 거래량 누적: 오른 날은 더하고 내린 날은 빼요.
export function obv(bars: Ohlcv[]): number[] {
  const out: number[] = [];
  bars.forEach((b, i) => {
    const prev = i ? out[i - 1] : 0;
    const v = b.volume ?? 0;
    out.push(i === 0 ? 0 : b.close > bars[i - 1].close ? prev + v : b.close < bars[i - 1].close ? prev - v : prev);
  });
  return out;
}

// 일목균형표. spanA·spanB는 i번째 봉에서 계산한 값이고, 차트에는 shift(26)칸 앞으로 옮겨 그려요.
export const ICHIMOKU = { tenkan: 9, kijun: 26, spanB: 52, shift: 26 } as const;
export function ichimoku(bars: Ohlcv[]) {
  const mid = (i: number, n: number) => {
    if (i < n - 1) return null;
    const w = bars.slice(i - n + 1, i + 1);
    return (Math.max(...w.map((b) => b.high)) + Math.min(...w.map((b) => b.low))) / 2;
  };
  const tenkan = bars.map((_, i) => mid(i, ICHIMOKU.tenkan));
  const kijun = bars.map((_, i) => mid(i, ICHIMOKU.kijun));
  const spanA = bars.map((_, i) => (tenkan[i] === null || kijun[i] === null ? null : (tenkan[i]! + kijun[i]!) / 2));
  const spanB = bars.map((_, i) => mid(i, ICHIMOKU.spanB));
  return { tenkan, kijun, spanA, spanB, shift: ICHIMOKU.shift };
}

// 거래량 가중 평균가. group이 바뀌는 봉(분봉이면 날짜)에서 처음부터 다시 쌓아요. from 앞 봉은 비워요.
export function vwap(bars: Ohlcv[], group: (i: number) => string = () => "", from = 0): (number | null)[] {
  let pv = 0, vol = 0, key: string | null = null;
  return bars.map((b, i) => {
    if (i < from) return null;
    const g = group(i);
    if (g !== key) { pv = 0; vol = 0; key = g; }
    const v = b.volume ?? 0;
    pv += ((b.high + b.low + b.close) / 3) * v;
    vol += v;
    return vol > 0 ? pv / vol : null;
  });
}

// 매물대: 보이는 봉의 거래량을 가격대 칸(bins)에 나눠 담아요. 봉 하나의 거래량은 그 봉의 저가~고가 칸에 고르게 나눠요.
export function volumeProfile(bars: Ohlcv[], bins = 24): { low: number; high: number; volume: number }[] {
  const withVol = bars.filter((b) => (b.volume ?? 0) > 0);
  if (!withVol.length) return [];
  const lo = Math.min(...withVol.map((b) => b.low)), hi = Math.max(...withVol.map((b) => b.high));
  if (!(hi > lo)) return [];
  const step = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, k) => ({ low: lo + k * step, high: lo + (k + 1) * step, volume: 0 }));
  for (const b of withVol) {
    const a = Math.min(bins - 1, Math.floor((b.low - lo) / step));
    const z = Math.max(a, Math.min(bins - 1, Math.ceil((b.high - lo) / step) - 1)); // 칸 경계에 딱 걸친 고가는 아래 칸으로
    const share = (b.volume ?? 0) / (z - a + 1);
    for (let k = a; k <= z; k++) out[k].volume += share;
  }
  return out;
}

// ---------------------------------------------------------------- 캔들 패턴
export type PatternKey = "hammer" | "shooting" | "bullEngulf" | "bearEngulf" | "doji";
export const PATTERNS: Record<PatternKey, { name: string; bull: boolean | null; text: string }> = {
  hammer: { name: "망치형", bull: true, text: "빠지던 중에 아래꼬리가 길게 달렸어요. 많이 빠졌다가 다시 올라와 끝났다는 뜻이라, 바닥 신호일 때가 많아요. 다음 봉이 오르는지 같이 보세요." },
  shooting: { name: "유성형", bull: false, text: "오르던 중에 위꼬리가 길게 달렸어요. 올랐다가 다시 밀려 끝났다는 뜻이라, 꼭대기 신호일 때가 많아요." },
  bullEngulf: { name: "상승 장악형", bull: true, text: "빠지던 중에 전날 음봉을 통째로 덮는 큰 양봉이 나왔어요. 사려는 힘이 세졌다는 신호예요." },
  bearEngulf: { name: "하락 장악형", bull: false, text: "오르던 중에 전날 양봉을 통째로 덮는 큰 음봉이 나왔어요. 팔려는 힘이 세졌다는 신호예요." },
  doji: { name: "도지", bull: null, text: "시가와 종가가 거의 같아요. 사려는 힘과 팔려는 힘이 맞섰다는 뜻이라, 크게 오르거나 빠진 뒤에 나오면 방향이 바뀔 수 있어요." },
};

// 앞 5봉 동안 3% 넘게 오르거나 빠졌을 때만 봐요. 흐름 없이 나온 패턴은 의미가 적어서요.
const TREND_BARS = 5, TREND_PCT = 3;
export function patterns(bars: Ohlcv[]): { i: number; key: PatternKey }[] {
  const out: { i: number; key: PatternKey }[] = [];
  const ranges = bars.map((b) => b.high - b.low);
  const avgRange = sma(ranges, 20);
  for (let i = TREND_BARS + 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    const range = b.high - b.low;
    if (!(range > 0) || avgRange[i - 1] === null || range < avgRange[i - 1]! * 0.6) continue; // 너무 작은 봉은 건너뛰어요
    const move = (p.close / bars[i - 1 - TREND_BARS].close - 1) * 100;
    const down = move <= -TREND_PCT, up = move >= TREND_PCT;
    if (!down && !up) continue;
    const body = Math.abs(b.close - b.open);
    const upper = b.high - Math.max(b.open, b.close), lower = Math.min(b.open, b.close) - b.low;
    const pBody = Math.abs(p.close - p.open);
    let key: PatternKey | null = null;
    if (down && p.close < p.open && b.close > b.open && b.open <= p.close && b.close >= p.open && body > pBody) key = "bullEngulf";
    else if (up && p.close > p.open && b.close < b.open && b.open >= p.close && b.close <= p.open && body > pBody) key = "bearEngulf";
    else if (body <= range * 0.08) key = "doji";
    else if (down && lower >= body * 2 && upper <= body * 0.6) key = "hammer";
    else if (up && upper >= body * 2 && lower <= body * 0.6) key = "shooting";
    if (key) out.push({ i, key });
  }
  return out;
}

// ---------------------------------------------------------------- RSI 다이버전스
export type Divergence = { a: number; b: number; kind: "bear" | "bull" };
// 좌우 k봉보다 높은(낮은) 봉을 고점(저점)으로 봐요. 이웃한 두 고점에서 가격은 높아졌는데 RSI가 낮아지면 하락 다이버전스,
// 두 저점에서 가격은 낮아졌는데 RSI가 높아지면 상승 다이버전스예요. 두 점은 maxGap봉 안에 있어야 해요.
export function divergences(bars: Ohlcv[], r: (number | null)[], k = 5, maxGap = 60): Divergence[] {
  const pivots = (pick: (b: Ohlcv) => number, cmp: (a: number, b: number) => boolean) => {
    const out: number[] = [];
    for (let i = k; i < bars.length - k; i++) {
      const v = pick(bars[i]);
      let ok = true;
      for (let j = i - k; j <= i + k && ok; j++) if (j !== i && !cmp(v, pick(bars[j]))) ok = false;
      if (ok && r[i] !== null) out.push(i);
    }
    return out;
  };
  const out: Divergence[] = [];
  const highs = pivots((b) => b.high, (a, b) => a >= b);
  for (let n = 1; n < highs.length; n++) {
    const a = highs[n - 1], b = highs[n];
    if (b - a <= maxGap && bars[b].high > bars[a].high && r[b]! < r[a]! - 2) out.push({ a, b, kind: "bear" });
  }
  const lows = pivots((b) => b.low, (a, b) => a <= b);
  for (let n = 1; n < lows.length; n++) {
    const a = lows[n - 1], b = lows[n];
    if (b - a <= maxGap && bars[b].low < bars[a].low && r[b]! > r[a]! + 2) out.push({ a, b, kind: "bull" });
  }
  return out.sort((x, y) => x.b - y.b);
}

// ---------------------------------------------------------------- 지표 숫자 설정
export type Settings = { ma: number[]; bb: [number, number]; rsi: number; macd: [number, number, number]; stoch: [number, number] };
export const DEFAULTS: Settings = { ma: [5, 20, 60, 120], bb: [20, 2], rsi: 14, macd: [12, 26, 9], stoch: [14, 3] };

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};
// 저장해 둔 값이 이상하면(손으로 고쳤거나 옛 모양) 그 칸만 기본값으로 돌려요.
export function cleanSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const ma = arr(r.ma).map((v) => clampInt(v, 2, 400, 0)).filter((v) => v > 0).slice(0, 4);
  const bb = arr(r.bb), mc = arr(r.macd), st = arr(r.stoch);
  const k = Number(bb[1]);
  const fast = clampInt(mc[0], 2, 100, DEFAULTS.macd[0]), slow = clampInt(mc[1], 3, 200, DEFAULTS.macd[1]);
  return {
    ma: ma.length ? [...new Set(ma)] : DEFAULTS.ma,
    bb: [clampInt(bb[0], 5, 200, DEFAULTS.bb[0]), Number.isFinite(k) && k >= 0.5 && k <= 5 ? Math.round(k * 10) / 10 : DEFAULTS.bb[1]],
    rsi: clampInt(r.rsi, 2, 100, DEFAULTS.rsi),
    macd: fast < slow ? [fast, slow, clampInt(mc[2], 2, 50, DEFAULTS.macd[2])] : DEFAULTS.macd,
    stoch: [clampInt(st[0], 3, 100, DEFAULTS.stoch[0]), clampInt(st[1], 1, 20, DEFAULTS.stoch[1])],
  };
}
