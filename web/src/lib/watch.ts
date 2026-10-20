// 관심종목 화면 계산. 순수 함수만 둡니다.

export type WatchAlert = { id: number; direction: "above" | "below"; price: number; active: boolean; memo: string; triggeredAt: string | null };

// 목표가까지 남은 거리(%). 위로 알림은 +, 아래로 알림은 -로 나옵니다.
export function gapPct(cur: number, target: number): number {
  return Math.round(((target - cur) / cur) * 1000) / 10;
}

// 켜진 알림 중 현재가에서 가장 가까운 것
export function nearest(alerts: WatchAlert[], cur: number | null): WatchAlert | null {
  const on = alerts.filter((a) => a.active);
  if (!on.length) return null;
  if (cur === null) return on[0];
  return on.reduce((best, a) => (Math.abs(a.price - cur) < Math.abs(best.price - cur) ? a : best));
}

// 미니 차트 좌표. 목표가 선도 화면 안에 들어오도록 범위를 넓힙니다.
export function sparkGeometry(closes: number[], targets: number[], w: number, h: number, pad = 4) {
  const all = [...closes, ...targets];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const y = (v: number) => Math.round((pad + (hi - v) / (hi - lo) * (h - pad * 2)) * 10) / 10;
  const x = (i: number) => (closes.length > 1 ? Math.round((i / (closes.length - 1)) * w * 10) / 10 : w / 2);
  return { points: closes.map((c, i) => `${x(i)},${y(c)}`).join(" "), lines: targets.map(y) };
}

export function wayLabel(direction: "above" | "below") {
  return direction === "below" ? "아래로" : "위로";
}
