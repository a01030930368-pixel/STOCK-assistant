// lightweight-charts 그림 층: 지지·저항 구간·선과 낙서를 캔들 시리즈에 붙여 그립니다.
// 확대·이동할 때 차트가 알아서 다시 그려 줘서, 그림이 캔들과 같이 움직여요.
import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder, SeriesAttachedParameter, Time,
} from "lightweight-charts";
import { fibPrices, markColor, markLabel, SHAPE_LABEL, type DoodlePoint, type Mark, type Shape } from "@/lib/drawings";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export { RESIST, SUPPORT } from "@/lib/drawings";
const colorOf = markColor;

export type Stroke = { id: number | null; color: string; points: DoodlePoint[] };
export type DrawState = {
  marks: Mark[]; strokes: Stroke[]; visible: boolean;
  pending: number | null; // 구간 긋기에서 첫 번째로 누른 가격
  selected: number | null;
  shapes: Shape[];
  draft: { kind: Shape["kind"]; points: DoodlePoint[] } | null; // 그리는 중인 추세선·채널·피보나치(마지막 점은 손가락 자리)
  ruler: { a: DoodlePoint; b: DoodlePoint; text: string } | null;
};
export const TREND = "#e7cf9c", RULER = "#6fa8d9";
const FIB_COLORS = ["#9b968b", "#e8806f", "#d9b45a", "#6fbf9a", "#6fa8d9", "#b48ead", "#9b968b"];

export class Drawings implements ISeriesPrimitive<Time> {
  state: DrawState = { marks: [], strokes: [], visible: true, pending: null, selected: null, shapes: [], draft: null, ruler: null };
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private request: (() => void) | null = null;

  constructor(private index: Map<string, number>, private fmt: (v: number) => string) {}

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<"Candlestick">;
    this.request = p.requestUpdate;
  }
  detached() { this.chart = this.series = this.request = null; }

  set(next: Partial<DrawState>) {
    this.state = { ...this.state, ...next };
    this.request?.();
  }

  y(price: number): number | null { return this.series?.priceToCoordinate(price) ?? null; }
  x(key: string, frac: number): number | null {
    const i = this.index.get(key);
    if (i === undefined || !this.chart) return null;
    return this.chart.timeScale().logicalToCoordinate((i + frac) as never);
  }
  // 추세선·채널·피보나치의 화면 좌표. 점 하나라도 이 차트에 없으면 null.
  shapePixels(points: DoodlePoint[]): [number, number][] | null {
    const px = this.pixels(points);
    return px.length === points.length ? px : null;
  }
  // 낙서 점을 화면 좌표로. 지금 차트에 없는 봉의 점은 건너뜁니다.
  pixels(points: DoodlePoint[]): [number, number][] {
    const out: [number, number][] = [];
    for (const [k, f, p] of points) {
      const x = this.x(k, f), y = this.y(p);
      if (x !== null && y !== null) out.push([x, y]);
    }
    return out;
  }

  private zones: IPrimitivePaneView = { zOrder: (): PrimitivePaneViewZOrder => "bottom", renderer: () => this.render("zones") };
  private lines: IPrimitivePaneView = { zOrder: (): PrimitivePaneViewZOrder => "top", renderer: () => this.render("lines") };
  paneViews() { return [this.zones, this.lines]; }

  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    if (!this.state.visible) return [];
    // 선은 가격 하나, 구간은 위·아래 끝 가격을 오른쪽 가격 칸에 표시해요.
    return this.state.marks.flatMap((m) => (m.high === null ? [m.low] : [m.high, m.low]).map((price) => ({
      coordinate: () => this.y(price) ?? -100,
      text: () => this.fmt(price),
      textColor: () => "#0b0b0d",
      backColor: () => colorOf(m),
      visible: () => true,
      tickVisible: () => false,
    })));
  }

  private render(layer: "zones" | "lines"): IPrimitivePaneRenderer {
    return {
      draw: (target: Target) => target.useMediaCoordinateSpace(({ context: c, mediaSize }) => {
        const { marks, strokes, visible, pending, selected } = this.state;
        if (layer === "zones") {
          if (!visible) return;
          for (const m of marks) {
            if (m.high === null) continue;
            const top = this.y(m.high), bottom = this.y(m.low);
            if (top === null || bottom === null) continue;
            c.fillStyle = colorOf(m) + (m.id === selected ? "40" : "26");
            c.fillRect(0, top, mediaSize.width, bottom - top);
            c.strokeStyle = colorOf(m) + "80";
            c.lineWidth = 1;
            c.strokeRect(0.5, top + 0.5, mediaSize.width - 1, bottom - top);
          }
          return;
        }
        c.lineCap = "round";
        c.lineJoin = "round";
        if (visible) {
          c.font = "11.5px Pretendard, sans-serif";
          for (const m of marks) {
            const yv = this.y(m.high === null ? m.low : m.high);
            if (yv === null) continue;
            c.fillStyle = colorOf(m);
            if (m.high === null) {
              c.fillRect(0, Math.round(yv) - (m.id === selected ? 1 : 0.5), mediaSize.width, m.id === selected ? 2 : 1.5);
            }
            c.fillText(markLabel(m), 8, yv - 5);
          }
        }
        for (const s of strokes) {
          const px = this.pixels(s.points);
          if (!px.length) continue;
          c.strokeStyle = s.color;
          c.lineWidth = 2;
          c.beginPath();
          px.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
          if (px.length === 1) c.lineTo(px[0][0] + 0.1, px[0][1]);
          c.stroke();
        }
        const { shapes, draft, ruler } = this.state;
        if (visible) for (const sh of shapes) this.drawShape(c, sh.kind, sh.points, sh.color ?? TREND, mediaSize.width, sh.id === selected, sh.alert);
        if (draft && draft.points.length >= 2) this.drawShape(c, draft.kind, draft.points, TREND, mediaSize.width, true, false);
        else if (draft) {
          const px = this.shapePixels(draft.points);
          if (px) { c.fillStyle = TREND; c.beginPath(); c.arc(px[0][0], px[0][1], 4, 0, Math.PI * 2); c.fill(); }
        }
        if (ruler) this.drawRuler(c, ruler);
        if (pending !== null) {
          const yv = this.y(pending);
          if (yv !== null) {
            c.strokeStyle = "#c9a96b";
            c.setLineDash([4, 3]);
            c.beginPath(); c.moveTo(0, yv); c.lineTo(mediaSize.width, yv); c.stroke();
            c.setLineDash([]);
          }
        }
      }),
    };
  }

  // 추세선은 끝점 너머 오른쪽 끝까지 늘려 그려요(알림도 그 연장선으로 봐요).
  private drawShape(c: CanvasRenderingContext2D, kind: Shape["kind"], points: DoodlePoint[], color: string, width: number, bold: boolean, alert: boolean) {
    const px = this.shapePixels(points);
    if (!px || px.length < 2) return;
    const [[x1, y1], [x2, y2]] = px;
    c.lineWidth = bold ? 2 : 1.5;
    c.strokeStyle = color;
    c.fillStyle = color;
    if (kind === "fib") {
      const levels = fibPrices(points[0][2], points[1][2]);
      const left = Math.min(x1, x2);
      c.font = "11px Pretendard, sans-serif";
      levels.forEach((l, k) => {
        const y = this.y(l.price);
        if (y === null) return;
        c.strokeStyle = FIB_COLORS[k];
        c.fillStyle = FIB_COLORS[k];
        c.beginPath(); c.moveTo(left, y); c.lineTo(width, y); c.stroke();
        c.fillText(`${(l.ratio * 100).toFixed(1).replace(".0", "")}% · ${this.fmt(l.price)}`, left + 4, y - 4);
      });
      c.setLineDash([3, 3]);
      c.strokeStyle = "#9b968b";
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.setLineDash([]);
      return;
    }
    const ray = (ax: number, ay: number, bx: number, by: number) => {
      const ex = bx > ax ? width : bx < ax ? 0 : bx;
      const ey = bx === ax ? by : ay + ((by - ay) * (ex - ax)) / (bx - ax);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.stroke();
      return [ex, ey] as const;
    };
    const [ex, ey] = ray(x1, y1, x2, y2);
    for (const [x, y] of [[x1, y1], [x2, y2]]) { c.beginPath(); c.arc(x, y, bold ? 4 : 3, 0, Math.PI * 2); c.fill(); }
    if (kind === "channel" && px.length >= 3) {
      // 세 번째 점을 지나는 평행선
      const [x3, y3] = px[2];
      const slope = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1);
      const off = y3 - (y1 + slope * (x3 - x1));
      c.setLineDash([5, 4]);
      ray(x1, y1 + off, x2, y2 + off);
      c.setLineDash([]);
      c.globalAlpha = 0.07;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(ex, ey); c.lineTo(ex, ey + off); c.lineTo(x1, y1 + off); c.closePath(); c.fill();
      c.globalAlpha = 1;
    }
    c.font = "11.5px Pretendard, sans-serif";
    c.fillText(`${SHAPE_LABEL[kind]}${alert ? " 🔔" : ""}`, x2 + 6, y2 - 6);
  }

  private drawRuler(c: CanvasRenderingContext2D, r: NonNullable<DrawState["ruler"]>) {
    const px = this.shapePixels([r.a, r.b]);
    if (!px) return;
    const [[x1, y1], [x2, y2]] = px;
    c.fillStyle = RULER + "1f";
    c.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    c.strokeStyle = RULER;
    c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.font = "600 12px Pretendard, sans-serif";
    const w = c.measureText(r.text).width + 16;
    const bx = (x1 + x2) / 2 - w / 2, by = Math.min(y1, y2) - 28;
    c.fillStyle = "#1d2a3a";
    c.beginPath(); c.roundRect(bx, by, w, 22, 6); c.fill();
    c.fillStyle = "#8fb8e8";
    c.fillText(r.text, bx + 8, by + 15);
  }
}
