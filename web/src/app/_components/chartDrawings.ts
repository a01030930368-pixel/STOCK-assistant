// lightweight-charts 그림 층: 지지·저항 구간·선과 낙서를 캔들 시리즈에 붙여 그립니다.
// 확대·이동할 때 차트가 알아서 다시 그려 줘서, 그림이 캔들과 같이 움직여요.
import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder, SeriesAttachedParameter, Time,
} from "lightweight-charts";
import { KIND_LABEL, markColor, type DoodlePoint, type Mark } from "@/lib/drawings";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export { RESIST, SUPPORT } from "@/lib/drawings";
const colorOf = markColor;

export type Stroke = { id: number | null; color: string; points: DoodlePoint[] };
export type DrawState = {
  marks: Mark[]; strokes: Stroke[]; visible: boolean;
  pending: number | null; // 구간 긋기에서 첫 번째로 누른 가격
  selected: number | null;
};

export class Drawings implements ISeriesPrimitive<Time> {
  state: DrawState = { marks: [], strokes: [], visible: true, pending: null, selected: null };
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
            const label = `${KIND_LABEL[m.kind]}${m.memo ? ` · ${m.memo}` : ""}${m.alert ? " 🔔" : ""}`;
            c.fillText(label, 8, yv - 5);
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
}
