// 기업 공부 › 가설 탭의 "실적 예측 내기".
// 발표 전에 매출·영업이익이 시장 예상보다 높을지/비슷할지/낮을지, 다음 날 주가 방향, 확신, 한 줄 이유를 적어요.
// 채점은 워커(worker/app/bets.py)가 발표 뒤에 해요(예상 대비 ±2% 넘으면 높다/낮다, 예상이 없으면 내 숫자와 5% 안).
export type Dir = "up" | "same" | "down";
export type PxDir = "up" | "down";
export const DIR_WORD: Record<Dir, string> = { up: "높다", same: "비슷", down: "낮다" };
export const PX_WORD: Record<PxDir, string> = { up: "오른다", down: "내린다" };
const ARROW: Record<Dir, string> = { up: "↑", same: "→", down: "↓" };

export type ItemResult = { guess: Dir | PxDir | null; mine?: number | null; actual: number | null; est?: number | null; ok: boolean | null; by?: string; got?: Dir; pct?: number };
export type BetResult = { rev?: ItemResult; op?: ItemResult; px?: ItemResult; hits: number; total: number; day?: string };
export type Bet = {
  ticker: string; name: string; period: string; market: "KR" | "US";
  revDir: Dir | null; revValue: number | null; opDir: Dir | null; opValue: number | null; pxDir: PxDir | null; pxPct: number | null;
  confidence: number; reason: string; estRev: number | null; estOp: number | null; result: BetResult | null; updated: string;
};

// ---------------------------------------------------------------- 분기

export const nextPeriod = (p: string) => { const y = Number(p.slice(0, 4)), q = Number(p.slice(5)); return q === 4 ? `${y + 1}Q1` : `${y}Q${q + 1}`; };
export function lastEnded(today: string) {
  const y = Number(today.slice(0, 4)), q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  return q === 0 ? `${y - 1}Q4` : `${y}Q${q}`;
}
// 예측할 분기: 마지막으로 발표된 분기의 다음. 기록이 없으면 막 끝난 분기. (워커 bets.target_period와 같아요)
export const targetPeriod = (reported: string[], today: string) => (reported.length ? nextPeriod([...reported].sort().at(-1)!) : lastEnded(today));
export const periodWord = (p: string) => `${p.slice(2, 4)}년 ${p.slice(5)}분기`;
export const isLocked = (period: string, reported: string[]) => reported.some((r) => r >= period);

// ---------------------------------------------------------------- 숫자 단위: 국내는 조 원, 미국은 십억 달러(B)

export const UNIT = { KR: { word: "조 원", mul: 1e12 }, US: { word: "십억 달러", mul: 1e9 } } as const;
export function parseAmount(raw: string | undefined, market: "KR" | "US"): number | null {
  const s = (raw ?? "").replace(/[,\s$원]/g, "");
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)(조|억|B|b|M|m)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  const mul = m[2] === "조" ? 1e12 : m[2] === "억" ? 1e8 : m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "M" ? 1e6 : UNIT[market].mul;
  return n * mul;
}
export const amountText = (v: number | null, market: "KR" | "US") =>
  v === null ? "" : `${Math.round((v / UNIT[market].mul) * 100) / 100}`;
export function short(v: number | null, market: "KR" | "US") {
  if (v === null) return "-";
  if (market === "US") return Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6).toLocaleString("en-US")}M`;
  return Math.abs(v) >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : `${Math.round(v / 1e8).toLocaleString("ko-KR")}억`;
}

// ---------------------------------------------------------------- 입력 정리

export type BetInput = {
  ticker: string; period: string; revDir: Dir | null; revValue: number | null; opDir: Dir | null; opValue: number | null;
  pxDir: PxDir | null; pxPct: number | null; confidence: number; reason: string;
};
const dirOf = (v: string | undefined): Dir | null => (v === "up" || v === "same" || v === "down" ? v : null);

export function cleanBet(raw: Record<string, string>, market: "KR" | "US"): BetInput | { error: string } {
  const period = raw.period ?? "";
  if (!/^\d{4}Q[1-4]$/.test(period)) return { error: "분기를 찾지 못했어요." };
  const revValue = parseAmount(raw.revValue, market), opValue = parseAmount(raw.opValue, market);
  if (Number.isNaN(revValue) || Number.isNaN(opValue)) return { error: `숫자는 ${UNIT[market].word} 단위로 적어 주세요. 예: ${market === "KR" ? "34.5" : "35.1"}` };
  const pxDir = raw.pxDir === "up" || raw.pxDir === "down" ? raw.pxDir : null;
  let pxPct = raw.pxPct?.trim() ? Number(raw.pxPct.replace(/[%\s+]/g, "")) : null;
  if (pxPct !== null && (!Number.isFinite(pxPct) || Math.abs(pxPct) > 50)) return { error: "다음 날 주가는 −50%~+50% 사이로 적어 주세요." };
  if (pxPct !== null && pxDir) pxPct = pxDir === "down" ? -Math.abs(pxPct) : Math.abs(pxPct);
  const revDir = dirOf(raw.revDir), opDir = dirOf(raw.opDir);
  if (!revDir && !opDir && !pxDir && revValue === null && opValue === null) return { error: "매출·영업이익·주가 중 하나는 골라 주세요." };
  const confidence = Math.round(Math.max(50, Math.min(90, Number(raw.confidence) || 60)) / 5) * 5;
  return {
    ticker: (raw.ticker ?? "").toUpperCase(), period, revDir, revValue, opDir, opValue, pxDir, pxPct, confidence,
    reason: (raw.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
  };
}

// ---------------------------------------------------------------- 성적

export type Stats = {
  scored: number; dirHits: number; dirTotal: number; confHits: number; confTotal: number; pxHits: number; pxTotal: number;
  habits: string[];
};

export function stats(bets: Pick<Bet, "result" | "confidence">[]): Stats {
  const s: Stats = { scored: 0, dirHits: 0, dirTotal: 0, confHits: 0, confTotal: 0, pxHits: 0, pxTotal: 0, habits: [] };
  const miss = { rev: { up: 0, down: 0, all: 0 }, op: { up: 0, down: 0, all: 0 } };
  for (const b of bets) {
    const r = b.result;
    if (!r || !r.total) continue;
    s.scored++;
    for (const k of ["rev", "op"] as const) {
      const it = r[k];
      if (!it || it.ok === null) continue;
      s.dirTotal++; if (it.ok) s.dirHits++;
      if (!it.ok && it.by === "consensus" && it.guess) {
        miss[k].all++;
        if (it.guess === "up") miss[k].up++;
        if (it.guess === "down") miss[k].down++;
      }
    }
    if (r.px && r.px.ok !== null) { s.pxTotal++; if (r.px.ok) s.pxHits++; }
    if (b.confidence >= 80) for (const it of [r.rev, r.op, r.px]) if (it && it.ok !== null) { s.confTotal++; if (it.ok) s.confHits++; }
  }
  for (const [k, label] of [["rev", "매출"], ["op", "영업이익"]] as const) {
    const m = miss[k];
    if (m.all >= 3 && m.up / m.all >= 0.6) s.habits.push(`${label}을 예상보다 높게 보는 쪽으로 ${m.all}번 중 ${m.up}번 틀렸어요. 좋아하는 회사에 후한 편일 수 있어요.`);
    else if (m.all >= 3 && m.down / m.all >= 0.6) s.habits.push(`${label}을 예상보다 낮게 보는 쪽으로 ${m.all}번 중 ${m.down}번 틀렸어요. 걱정이 많은 편일 수 있어요.`);
  }
  const all = s.dirTotal + s.pxTotal, hits = s.dirHits + s.pxHits;
  if (s.confTotal >= 4 && all > 0 && s.confHits / s.confTotal < hits / all - 0.1) s.habits.push("확신 80% 이상일 때 오히려 덜 맞혀요. 자신 있을 때 한 번 더 의심해 보세요.");
  return s;
}

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

// 지난 예측 한 줄 요약: "매출 ↑ · 이익 → · 주가 ↓ 70%"
export function betLine(b: Pick<Bet, "revDir" | "opDir" | "pxDir" | "confidence">) {
  const parts: string[] = [];
  if (b.revDir) parts.push(`매출 ${ARROW[b.revDir]}`);
  if (b.opDir) parts.push(`이익 ${ARROW[b.opDir]}`);
  if (b.pxDir) parts.push(`주가 ${b.pxDir === "up" ? "↑" : "↓"}`);
  return `${parts.join(" · ")} ${b.confidence}%`.trim();
}

export function resultMarks(r: BetResult | null): { label: string; ok: boolean | null }[] {
  if (!r) return [];
  return ([["rev", "매출"], ["op", "영업이익"], ["px", "주가"]] as const).flatMap(([k, label]) => (r[k] ? [{ label, ok: r[k]!.ok }] : []));
}

// 실제 쪽 요약: "매출 +4.1% · 이익 +4.6% · 주가 −2.1%" (예상 대비, 주가는 다음 날)
export function actualLine(r: BetResult | null) {
  if (!r) return "채점 기다리는 중";
  const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
  const parts: string[] = [];
  if (r.rev?.pct !== undefined) parts.push(`매출 ${sign(r.rev.pct)}`);
  if (r.op?.pct !== undefined) parts.push(`이익 ${sign(r.op.pct)}`);
  if (r.px && r.px.actual !== null) parts.push(`주가 ${sign(r.px.actual)}`);
  return parts.length ? parts.join(" · ") : "숫자가 없어 채점하지 못했어요";
}

// 내가 적은 예측 모아 보기: 채점 기다리는 것(최근 분기 먼저) → 채점 끝난 것(최근 분기 먼저)
export function listOrder<T extends Pick<Bet, "period" | "result" | "updated" | "ticker">>(bets: T[]): T[] {
  const waiting = (b: T) => !(b.result && b.result.total);
  return [...bets].sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || b.period.localeCompare(a.period) || b.updated.localeCompare(a.updated) || a.ticker.localeCompare(b.ticker));
}
