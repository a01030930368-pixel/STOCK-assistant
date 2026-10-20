// 차트 위 그림: 지지·저항(가격 기준이라 모든 차트에 보임)과 낙서(그린 차트에서만 보임). DB와 무관한 순수 함수입니다.

export type LevelKind = "support" | "resistance";
export type Mark = { id: number; kind: LevelKind; low: number; high: number | null; memo: string; alert: boolean };
// 낙서 점: [봉 키, 봉 안 위치(-0.5~0.5), 가격]. 봉 키는 일봉이면 날짜, 분봉이면 시각(초)이에요.
export type DoodlePoint = [string, number, number];
export type Doodle = { id: number; view: string; color: string; points: DoodlePoint[] };

export const KIND_LABEL: Record<LevelKind, string> = { support: "지지", resistance: "저항" };

// 지금 가격보다 위에 그리면 저항, 아래면 지지예요.
export function kindFor(low: number, high: number | null, current: number): LevelKind {
  return (high === null ? low : (low + high) / 2) >= current ? "resistance" : "support";
}

export function zone(a: number, b: number): { low: number; high: number } {
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

// 지금 가격에서 가장 가까운 위쪽 저항과 아래쪽 지지, 거기까지 몇 %인지
export function nearest(marks: Mark[], current: number): { above?: { mark: Mark; pct: number }; below?: { mark: Mark; pct: number } } {
  let above: { mark: Mark; pct: number } | undefined, below: { mark: Mark; pct: number } | undefined;
  for (const m of marks) {
    const top = m.high ?? m.low;
    if (m.low > current) {
      const pct = (m.low / current - 1) * 100;
      if (!above || pct < above.pct) above = { mark: m, pct };
    } else if (top < current) {
      const pct = (top / current - 1) * 100;
      if (!below || pct > below.pct) below = { mark: m, pct };
    }
  }
  return { above, below };
}

// 점 p에서 선분 a-b까지의 거리(픽셀)
export function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function strokeDistance(p: [number, number], pts: [number, number][]): number {
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segmentDistance(p, pts[i - 1], pts[i]));
  return best;
}

// 손 떨림으로 생긴 너무 가까운 점은 빼서 저장 크기를 줄입니다(픽셀 기준).
export function thin(pts: [number, number][], min = 2): number[] {
  const keep: number[] = [];
  let last: [number, number] | null = null;
  pts.forEach((p, i) => {
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min || i === pts.length - 1) {
      keep.push(i);
      last = p;
    }
  });
  return keep;
}

export function validDoodle(points: unknown): points is DoodlePoint[] {
  return Array.isArray(points) && points.length > 0 && points.length <= 2000 &&
    points.every((p) => Array.isArray(p) && p.length === 3 && typeof p[0] === "string" && p[0].length <= 20 &&
      Number.isFinite(p[1]) && Number.isFinite(p[2]) && p[2] > 0);
}

// 자석: 후보 가격(캔들의 시·고·저·종) 중 화면에서 maxPx 안에 있는 가장 가까운 것. 없으면 null.
export function snap(y: number, candidates: number[], toY: (price: number) => number | null, maxPx: number): number | null {
  let best: number | null = null, gap = maxPx;
  for (const c of candidates) {
    const cy = toY(c);
    if (cy === null) continue;
    const d = Math.abs(cy - y);
    if (d <= gap) { best = c; gap = d; }
  }
  return best;
}

// 선·구간 끝을 끌어서 옮긴 결과. 구간의 위 끝을 아래 끝보다 내리면 서로 바뀌어요.
export function moveEdge(m: Mark, edge: "low" | "high", price: number): Mark {
  if (m.high === null) return { ...m, low: price };
  const other = edge === "low" ? m.high : m.low;
  return { ...m, low: Math.min(price, other), high: Math.max(price, other) };
}
