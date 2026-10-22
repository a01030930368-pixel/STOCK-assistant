// lightweight-charts 지표 그림 층: 일목균형표 구름대, 매물대, 다이버전스 선.
// 구름대는 마지막 봉보다 26칸 앞까지 그려야 해서 시리즈 대신 봉 번호(logical)로 직접 그려요.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitivePaneViewZOrder, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { volumeProfile, type Ohlcv } from "@/lib/indicators";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
export type Segment = { a: number; b: number; pa: number; pb: number; color: string; label?: string };
export type OverlayState = {
  cloud: { a: (number | null)[]; b: (number | null)[]; shift: number } | null;
  profile: Ohlcv[] | null; // 이 봉들 중 화면에 보이는 것만 모아 매물대를 그려요
  segments: Segment[];
};
export const CLOUD_UP = "#6fbf9a", CLOUD_DOWN = "#e8806f";
const PROFILE = "#5b6478", POC = "#c9a96b";

export class Overlay implements ISeriesPrimitive<Time> {
  state: OverlayState = { cloud: null, profile: null, segments: [] };
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private request: (() => void) | null = null;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<SeriesType>;
    this.request = p.requestUpdate;
  }
  detached() { this.chart = this.series = this.request = null; }
  set(next: Partial<OverlayState>) {
    this.state = { ...this.state, ...next };
    this.request?.();
  }

  private x(i: number) { return this.chart?.timeScale().logicalToCoordinate(i as never) ?? null; }
  private y(v: number) { return this.series?.priceToCoordinate(v) ?? null; }

  private back: IPrimitivePaneView = { zOrder: (): PrimitivePaneViewZOrder => "bottom", renderer: () => this.render("back") };
  private front: IPrimitivePaneView = { zOrder: (): PrimitivePaneViewZOrder => "top", renderer: () => this.render("front") };
  paneViews() { return [this.back, this.front]; }

  private render(layer: "back" | "front"): IPrimitivePaneRenderer {
    return {
      draw: (target: Target) => target.useMediaCoordinateSpace(({ context: c, mediaSize }) => {
        const { cloud, profile, segments } = this.state;
        if (layer === "back") {
          if (cloud) this.drawCloud(c, cloud);
          if (profile) this.drawProfile(c, profile, mediaSize.width);
          return;
        }
        c.lineWidth = 1.6;
        c.font = "11px Pretendard, sans-serif";
        for (const s of segments) {
          const xa = this.x(s.a), xb = this.x(s.b), ya = this.y(s.pa), yb = this.y(s.pb);
          if (xa === null || xb === null || ya === null || yb === null) continue;
          c.strokeStyle = s.color;
          c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb); c.stroke();
          if (s.label) { c.fillStyle = s.color; c.fillText(s.label, xb + 6, yb + 4); }
        }
      }),
    };
  }

  private drawCloud(c: CanvasRenderingContext2D, cloud: NonNullable<OverlayState["cloud"]>) {
    const pts: { x: number; a: number; b: number; up: boolean }[] = [];
    cloud.a.forEach((a, i) => {
      const b = cloud.b[i];
      if (a === null || b === null) return;
      const x = this.x(i + cloud.shift), ya = this.y(a), yb = this.y(b);
      if (x !== null && ya !== null && yb !== null) pts.push({ x, a: ya, b: yb, up: a >= b });
    });
    // 이웃한 두 점 사이를 사각형으로 채워요. 선행스팬1이 위면 초록, 아래면 빨강.
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k];
      c.fillStyle = (q.up ? CLOUD_UP : CLOUD_DOWN) + "26";
      c.beginPath(); c.moveTo(p.x, p.a); c.lineTo(q.x, q.a); c.lineTo(q.x, q.b); c.lineTo(p.x, p.b); c.closePath(); c.fill();
    }
    for (const [key, color] of [["a", CLOUD_UP], ["b", CLOUD_DOWN]] as const) {
      c.strokeStyle = color + "b0";
      c.lineWidth = 1;
      c.beginPath();
      pts.forEach((p, k) => (k ? c.lineTo(p.x, p[key]) : c.moveTo(p.x, p[key])));
      c.stroke();
    }
  }

  private drawProfile(c: CanvasRenderingContext2D, bars: Ohlcv[], width: number) {
    const range = this.chart?.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const shown = bars.slice(Math.max(0, Math.floor(range.from)), Math.max(0, Math.ceil(range.to) + 1));
    const bins = volumeProfile(shown, 24);
    const top = Math.max(...bins.map((b) => b.volume));
    if (!(top > 0)) return;
    const max = width * 0.22;
    const poc = bins.findIndex((b) => b.volume === top);
    bins.forEach((b, k) => {
      const y1 = this.y(b.high), y2 = this.y(b.low);
      if (y1 === null || y2 === null) return;
      const len = (b.volume / top) * max;
      c.fillStyle = k === poc ? POC + "8c" : PROFILE + "52";
      c.fillRect(width - len, y1 + 1, len, Math.max(1, y2 - y1 - 2));
    });
    const y = this.y((bins[poc].low + bins[poc].high) / 2);
    if (y !== null) {
      c.fillStyle = POC;
      c.font = "11px Pretendard, sans-serif";
      c.textAlign = "right";
      c.fillText("거래 가장 많은 가격대", width - 6, y - 8);
      c.textAlign = "left";
    }
  }
}
