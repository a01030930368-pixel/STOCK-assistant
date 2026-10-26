// 차트 위 그림: 지지·저항(가격 기준이라 모든 차트에 보임)과 낙서(그린 차트에서만 보임). DB와 무관한 순수 함수입니다.

export type LevelKind = "support" | "resistance";
export type Mark = { id: number; kind: LevelKind; low: number; high: number | null; memo: string; alert: boolean; color: string | null };
// 낙서 점: [봉 키, 봉 안 위치(-0.5~0.5), 가격]. 봉 키는 일봉이면 날짜, 분봉이면 시각(초)이에요.
export type DoodlePoint = [string, number, number];
export type Doodle = { id: number; view: string; color: string; points: DoodlePoint[] };

export const KIND_LABEL: Record<LevelKind, string> = { support: "지지", resistance: "저항" };
export const SUPPORT = "#86a8e6", RESIST = "#e8806f";
// 선·구간에 고를 수 있는 색. 첫 칸(null)은 지지 파랑·저항 빨강 그대로예요.
export const COLORS: { value: string | null; label: string }[] = [
  { value: null, label: "기본" }, { value: "#c9a96b", label: "금색" }, { value: "#7fb8a4", label: "초록" },
  { value: "#b48ead", label: "보라" }, { value: "#e0a458", label: "주황" }, { value: "#ece8df", label: "흰색" },
  { value: "#e8806f", label: "빨강" }, { value: "#86a8e6", label: "파랑" },
];
// 차트 위 선 이름: 내가 이름을 붙였으면 그 이름만, 아니면 지지·저항
export const markLabel = (m: Pick<Mark, "kind" | "memo" | "alert">) => `${m.memo || KIND_LABEL[m.kind]}${m.alert ? " 🔔" : ""}`;
export const markColor = (m: Pick<Mark, "kind" | "color">) => m.color ?? (m.kind === "support" ? SUPPORT : RESIST);
export const validColor = (c: unknown): c is string | null => c === null || (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c));

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

// ---------------------------------------------------------------- 추세선·평행 채널·피보나치
// points: 추세선 [시작, 끝], 채널 [시작, 끝, 평행선 높이], 피보나치 [시작(0%), 끝(100%)]
export type ShapeKind = "trend" | "channel" | "fib";
export type Shape = { id: number; view: string; kind: ShapeKind; points: DoodlePoint[]; color: string | null; alert: boolean };
export const SHAPE_POINTS: Record<ShapeKind, number> = { trend: 2, channel: 3, fib: 2 };
export const SHAPE_LABEL: Record<ShapeKind, string> = { trend: "추세선", channel: "평행 채널", fib: "피보나치" };
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function validShape(kind: unknown, points: unknown): kind is ShapeKind {
  return (kind === "trend" || kind === "channel" || kind === "fib") && validDoodle(points) && points.length === SHAPE_POINTS[kind];
}

// 추세선·채널의 두 점을 시간 순으로(채널 세 번째 점은 그대로). 피보나치는 시작·끝 순서가 뜻이 있어서 그대로예요.
// at(key) = 봉 번호. 워커는 선을 오늘 쪽으로 늘려 알림을 보니, 저장도 왼쪽 → 오른쪽으로 맞춰요.
export function sortShapePoints(kind: ShapeKind, points: DoodlePoint[], at: (key: string) => number): DoodlePoint[] {
  if (kind === "fib" || points.length < 2) return points;
  const [a, b, ...rest] = points;
  return at(b[0]) + b[1] < at(a[0]) + a[1] ? [b, a, ...rest] : points;
}

// 피보나치 되돌림: 끝점(100% 반대쪽)에서 시작점 쪽으로 되돌아온 비율마다의 가격. 0%는 끝점, 100%는 시작점이에요.
export function fibPrices(start: number, end: number): { ratio: number; price: number }[] {
  return FIB_LEVELS.map((r) => ({ ratio: r, price: end - (end - start) * r }));
}

// 자: 두 점 사이 등락률, 봉 수, 날짜 수
export function measure(a: { price: number; index: number; day: string }, b: { price: number; index: number; day: string }): string {
  const pct = (b.price / a.price - 1) * 100;
  const bars = Math.abs(Math.round(b.index - a.index));
  const days = Math.abs(Math.round((Date.parse(b.day) - Date.parse(a.day)) / 86400000));
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}% · ${bars}봉 · ${days}일`;
}
