// 관심종목 › 연습하기 › 기록: 지난 연습 판들의 성적표와 버릇 찾기. DB와 무관한 순수 함수예요.

export type PracticeTrade = { day: string; side: "buy" | "sell"; price: number };
export type Session = {
  id: number; ticker: string; name: string; start: string; end: string; blind: boolean;
  trades: PracticeTrade[]; mine: number; hold: number; calls: number; hits: number;
  played: string; // 연습한 날(한국 날짜)
};

// 들고만 있었을 때보다 더 벌었으면(덜 잃었으면) 이긴 판이에요.
export const won = (s: Session) => s.mine > s.hold;
export const marketOfTicker = (t: string): "KR" | "US" => (/^\d{6}$/.test(t) ? "KR" : "US");

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export type Summary = { count: number; thisMonth: number; wins: number; winPct: number; avgMine: number; avgHold: number; hitPct: number | null };
export function summarize(list: Session[], today: string): Summary {
  const calls = list.reduce((a, s) => a + s.calls, 0);
  return {
    count: list.length,
    thisMonth: list.filter((s) => s.played.slice(0, 7) === today.slice(0, 7)).length,
    wins: list.filter(won).length,
    winPct: pct(list.filter(won).length, list.length),
    avgMine: avg(list.map((s) => s.mine)),
    avgHold: avg(list.map((s) => s.hold)),
    hitPct: calls ? pct(list.reduce((a, s) => a + s.hits, 0), calls) : null,
  };
}

export type Filter = { kind: "all" | "blind" | "pick"; market: "all" | "KR" | "US" };
export function filterSessions(list: Session[], f: Filter): Session[] {
  return list.filter((s) => (f.kind === "all" || (f.kind === "blind") === s.blind) && (f.market === "all" || marketOfTicker(s.ticker) === f.market));
}

// 버릇 찾기: 판을 둘로 나눠 이긴 판 비율을 비교해요. 양쪽 다 MIN_SIDE판은 있어야 보여 줘요.
export const MIN_SIDE = 3;
export const HABIT_FROM = 10; // 이만큼 쌓이면 버릇 찾기를 보여 줘요
const EARLY_DAYS = 14; // 시작하고 2주(달력 기준) 안에 처음 샀으면 '일찍 산 판'

export type Side = { label: string; n: number; winPct: number };
export type Split = { title: string; a: Side; b: Side; note: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const firstBuy = (s: Session) => s.trades.find((t) => t.side === "buy");

export function habits(list: Session[]): Split[] {
  const defs: { title: string; a: string; b: string; inA: (s: Session) => boolean | null; better: [string, string] }[] = [
    { title: "오르는 차트 vs 내리는 차트", a: "오르는 차트", b: "내리는 차트", inA: (s) => s.hold > 0, better: ["오르는 차트에서 더 잘해요", "내리는 차트에서 더 잘해요"] },
    { title: "🎲 가린 판 vs 직접 고른 판", a: "🎲 가린 판", b: "직접 고른 판", inA: (s) => s.blind, better: ["가렸을 때 더 잘해요", "종목을 알 때 더 잘해요"] },
    { title: "국내 vs 미국", a: "국내", b: "미국", inA: (s) => marketOfTicker(s.ticker) === "KR", better: ["국내에서 더 잘해요", "미국에서 더 잘해요"] },
    { title: "매매 3번 이하 vs 4번 이상", a: "3번 이하", b: "4번 이상", inA: (s) => s.trades.length <= 3, better: ["적게 사고팔 때 더 잘해요", "자주 사고팔 때 더 잘해요"] },
    {
      title: "처음 2주 안에 산 판 vs 기다렸다 산 판", a: "일찍 산 판", b: "기다렸다 산 판",
      inA: (s) => { const b = firstBuy(s); return b ? daysBetween(s.start, b.day) <= EARLY_DAYS : null; },
      better: ["일찍 들어갈 때 더 잘해요", "기다렸다 살 때 더 잘해요"],
    },
  ];
  const out: Split[] = [];
  for (const d of defs) {
    const a: Session[] = [], b: Session[] = [];
    for (const s of list) { const v = d.inA(s); if (v === true) a.push(s); else if (v === false) b.push(s); }
    if (a.length < MIN_SIDE || b.length < MIN_SIDE) continue;
    const side = (label: string, xs: Session[]): Side => ({ label, n: xs.length, winPct: pct(xs.filter(won).length, xs.length) });
    const sa = side(d.a, a), sb = side(d.b, b);
    const gap = sa.winPct - sb.winPct;
    out.push({ title: d.title, a: sa, b: sb, note: Math.abs(gap) >= 15 ? d.better[gap > 0 ? 0 : 1] : "" });
  }
  return out;
}

// 한 줄 버릇 요약. 근거가 충분한 것만 골라요.
export function insights(list: Session[]): string[] {
  const out: string[] = [];
  const f1 = (v: number) => Math.abs(v).toFixed(1);
  const many = list.filter((s) => s.trades.length >= 4), few = list.filter((s) => s.trades.length <= 3);
  if (many.length >= MIN_SIDE && few.length >= MIN_SIDE) {
    const m = pct(many.filter(won).length, many.length), f = pct(few.filter(won).length, few.length);
    if (f - m >= 15) out.push(`매매를 4번 이상 한 판은 ${m}%만 이겼어요. 3번 이하는 ${f}%예요.`);
    else if (m - f >= 15) out.push(`자주 사고판 판이 ${m}% 이겨서, 3번 이하(${f}%)보다 나았어요.`);
  }
  const up = list.filter((s) => s.hold > 0);
  if (up.length >= MIN_SIDE) {
    const gap = avg(up.map((s) => s.mine - s.hold));
    if (gap <= -3) out.push(`오르는 차트에서는 들고만 있기보다 평균 ${f1(gap)}%p 덜 벌었어요. 너무 일찍 판 건 아닌지 보세요.`);
  }
  const down = list.filter((s) => s.hold < 0);
  if (down.length >= MIN_SIDE) {
    const gap = avg(down.map((s) => s.mine - s.hold));
    if (gap >= 3) out.push(`내리는 차트에서는 들고만 있기보다 평균 ${f1(gap)}%p 덜 잃었어요. 피하는 감은 좋아요.`);
    else if (gap <= -3) out.push(`내리는 차트에서 들고만 있기보다 평균 ${f1(gap)}%p 더 잃었어요. 떨어질 때 사서 물타기한 판을 다시 보세요.`);
  }
  let rebuy = 0;
  for (const s of list) for (let k = 1; k < s.trades.length; k++) {
    const p = s.trades[k - 1], t = s.trades[k];
    if (p.side === "sell" && t.side === "buy" && daysBetween(p.day, t.day) <= 7) rebuy++;
  }
  if (rebuy >= 3) out.push(`판 뒤 일주일 안에 다시 산 게 ${rebuy}번이에요.`);
  const idle = list.filter((s) => s.trades.length === 0).length;
  if (idle >= 3) out.push(`한 번도 안 사고 끝낸 판이 ${idle}번이에요.`);
  if (list.length >= 20) {
    const byTime = [...list].sort((a, b) => a.id - b.id);
    const rate = (xs: Session[]) => { const c = xs.reduce((a, s) => a + s.calls, 0); return c ? pct(xs.reduce((a, s) => a + s.hits, 0), c) : null; };
    const first = rate(byTime.slice(0, 10)), last = rate(byTime.slice(-10));
    if (first !== null && last !== null && Math.abs(last - first) >= 10)
      out.push(`최근 10판 맞힘률은 ${last}%로, 처음 10판(${first}%)보다 ${last > first ? `${last - first}%p 올랐어요` : `${first - last}%p 내려갔어요`}.`);
  }
  return out;
}
