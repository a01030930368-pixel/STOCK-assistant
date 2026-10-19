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
