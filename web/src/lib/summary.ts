// 보유 종목마다 "지금 무엇을 봐야 하는지"를 한 줄로 만듭니다. 중요한 것부터 최대 3개를 붙입니다.

export type SummaryInput = {
  pnlPct: number;
  hasJournal: boolean;
  stopDist: number | null; // 손절가까지 남은 거리(%)
  targetDist: number | null; // 목표가까지 남은 거리(%)
  nextEarnings: string | null; // YYYY-MM-DD
  daysToEarnings: number | null;
  lastSurprise: number | null; // 지난 분기 EPS 실제 - 예상
  recentNews: number; // 최근 3일 뉴스 수
};

export type Part = { text: string; tone: "warn" | "gold" | "up" | "down" | "" };

const pct = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

export function summarize(s: SummaryInput): Part[] {
  const parts: Part[] = [];
  if (s.stopDist !== null && s.stopDist <= 5) parts.push({ text: `손절가까지 ${s.stopDist.toFixed(1)}%`, tone: "warn" });
  if (s.targetDist !== null && s.targetDist <= 5) parts.push({ text: `목표가까지 ${s.targetDist.toFixed(1)}%`, tone: "gold" });
  if (s.nextEarnings && s.daysToEarnings !== null && s.daysToEarnings <= 14) {
    const day = `${Number(s.nextEarnings.slice(5, 7))}.${Number(s.nextEarnings.slice(8))}`;
    parts.push({ text: s.daysToEarnings === 0 ? "오늘 실적 발표" : `${day} 실적 발표(D-${s.daysToEarnings})`, tone: "gold" });
  }
  if (!s.hasJournal) parts.push({ text: "손절·목표가 없음", tone: "warn" });
  if (s.lastSurprise !== null && s.lastSurprise !== 0) {
    parts.push(s.lastSurprise > 0 ? { text: "지난 분기 EPS 예상 상회", tone: "up" } : { text: "지난 분기 EPS 예상 하회", tone: "down" });
  }
  if (s.recentNews > 0) parts.push({ text: `최근 3일 뉴스 ${s.recentNews}건`, tone: "" });
  if (parts.length === 0 || (s.stopDist === null && s.targetDist === null && Math.abs(s.pnlPct) >= 15)) {
    parts.unshift({ text: `평단 대비 ${pct(s.pnlPct)}`, tone: s.pnlPct > 0 ? "up" : s.pnlPct < 0 ? "down" : "" });
  }
  return parts.slice(0, 3);
}
