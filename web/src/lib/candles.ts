// 차트용 봉 계산: 주봉·월봉 묶기, 이동평균, RSI. 화면 없이 테스트할 수 있게 따로 둡니다.
export type Candle = { day: string; open: number; high: number; low: number; close: number; volume: number | null };
export type Period = "D" | "W" | "M";

// 주봉은 그 주 월요일, 월봉은 그 달 1일을 봉 날짜로 씁니다.
export function bucketOf(day: string, period: Period): string {
  if (period === "D") return day;
  if (period === "M") return `${day.slice(0, 7)}-01`;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function aggregate(candles: Candle[], period: Period): Candle[] {
  if (period === "D") return candles;
  const out: Candle[] = [];
  for (const c of candles) {
    const day = bucketOf(c.day, period);
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume = last.volume === null && c.volume === null ? null : (last.volume ?? 0) + (c.volume ?? 0);
    } else {
      out.push({ ...c, day });
    }
  }
  return out;
}

export function sma(values: number[], n: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    return i >= n - 1 ? sum / n : null;
  });
}

// 볼린저 밴드: 가운데는 n일 이동평균, 위·아래는 표준편차의 k배. 증권사 HTS 기본값(20, 2)과 같아요.
export function bollinger(values: number[], n = 20, k = 2): ({ mid: number; upper: number; lower: number } | null)[] {
  const mid = sma(values, n);
  return values.map((_, i) => {
    const m = mid[i];
    if (m === null) return null;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (values[j] - m) ** 2;
    const sd = Math.sqrt(sq / n);
    return { mid: m, upper: m + k * sd, lower: m - k * sd };
  });
}

// 와일더 방식 RSI. 증권사 HTS와 같은 계산입니다.
export function rsi(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    gain += Math.max(d, 0); loss += Math.max(-d, 0);
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// 분봉. t는 그 시장 현지 시각을 UTC인 것처럼 적은 초 단위 값입니다(차트가 현지 시각으로 보이게).
export type MinuteCandle = { t: number; open: number; high: number; low: number; close: number; volume: number };
export const MINUTES = [1, 3, 5, 15, 30, 60] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

export function wallClock(ts: Date, timeZone: string): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(ts).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000;
}

// N분봉은 장 시작 시각(국내 9:00, 미국 9:30)부터 N분씩 끊습니다. HTS와 같은 방식입니다.
export function aggregateMinutes(bars: MinuteCandle[], size: number, openSec: number): MinuteCandle[] {
  // 1분봉도 같은 분에 두 줄이 있으면(진행 중이던 봉) 하나로 합칩니다. 차트는 시각이 겹치면 그리지 못합니다.
  const step = size * 60;
  const out: MinuteCandle[] = [];
  for (const b of bars) {
    const dayStart = Math.floor(b.t / 86400) * 86400;
    const base = b.t >= dayStart + openSec ? dayStart + openSec : dayStart;
    const t = base + Math.floor((b.t - base) / step) * step;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b, t });
    }
  }
  return out;
}
