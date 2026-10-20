"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { addAlert, addChartMemo, addDoodle, addLevel, deleteChartMemo, deleteDoodle, deleteLevel, updateLevel } from "@/app/actions";
import { COLORS, KIND_LABEL, kindFor, markColor, moveEdge, nearest, snap, strokeDistance, thin, zone, type Doodle, type DoodlePoint, type Mark } from "@/lib/drawings";
import { Drawings, RESIST, SUPPORT, type Stroke } from "./chartDrawings";
import { aggregate, aggregateMinutes, bollinger, bucketOf, MINUTES, rsi, sma, type Candle, type MinuteCandle, type Period } from "@/lib/candles";

export type { Candle, MinuteCandle };
export type Memo = { id: number; day: string; body: string };
export type Trade = { day: string; side: "buy" | "sell"; price: number; quantity: number };
export type Level = { kind: "avg" | "stop" | "target" | "alert"; price: number };
export type { Doodle, Mark };
type Tool = "none" | "line" | "zone" | "move" | "pen" | "eraser";
const TOOLS: { key: Tool; label: string; hint: string }[] = [
  { key: "line", label: "― 선", hint: "차트에서 원하는 높이를 한 번 누르세요. 지금 가격보다 위면 저항, 아래면 지지예요." },
  { key: "zone", label: "▭ 구간", hint: "구간의 위·아래를 차례로 한 번씩 누르세요." },
  { key: "move", label: "↕ 옮기기", hint: "옮길 선이나 구간의 위·아래 끝을 잡고 위아래로 끄세요. 다 옮겼으면 ↕ 옮기기를 다시 눌러 끝내요." },
  { key: "pen", label: "✎ 낙서", hint: "손가락이나 마우스로 그리세요. 낙서는 이 차트에서만 보여요. 다 그렸으면 ✎ 낙서를 다시 눌러 끝내요." },
  { key: "eraser", label: "지우개", hint: "지울 낙서나 선을 누르세요." },
];
const PEN = "#e7cf9c";

const UP = "#e8806f", DOWN = "#86a8e6", GOLD = "#c9a96b", MUTED = "#9b968b", LINE = "#1b1b1f", BAND = "#a7a08f";
const MAS = [
  { n: 5, color: GOLD },
  { n: 20, color: "#b48ead" },
  { n: 60, color: "#7fb8a4" },
  { n: 120, color: "#8a857b" },
];
type View = Period | `${(typeof MINUTES)[number]}`;
const VIEWS: { key: View; label: string }[] = [
  ...MINUTES.map((n) => ({ key: `${n}` as View, label: `${n}분` })),
  { key: "D", label: "일" }, { key: "W", label: "주" }, { key: "M", label: "월" },
];
// 차트에 그리는 봉. 일·주·월봉은 날짜 문자열, 분봉은 현지 시각 초를 time으로 씁니다.
type Bar = { time: Time; key: string; label: string; day: string; open: number; high: number; low: number; close: number; volume: number | null };
const MINUTE_BARS_SHOWN = 150;
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
const RANGES = [
  { key: "3m", label: "3개월", months: 3 },
  { key: "6m", label: "6개월", months: 6 },
  { key: "1y", label: "1년", months: 12 },
  { key: "all", label: "전체", months: 0 },
] as const;
type Range = (typeof RANGES)[number]["key"];
const LEVEL = { avg: { label: "평단", color: GOLD }, stop: { label: "손절", color: DOWN }, target: { label: "목표", color: UP }, alert: { label: "알림", color: "#ece8df" } };

// 국내 호가 단위로 맞춥니다. 미국은 센트까지.
export function tickRound(v: number, market: string): number {
  if (market === "US") return Math.round(v * 100) / 100;
  const tick = v < 2000 ? 1 : v < 5000 ? 5 : v < 20000 ? 10 : v < 50000 ? 50 : v < 200000 ? 100 : v < 500000 ? 500 : 1000;
  return Math.round(v / tick) * tick;
}

const md = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const compact = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${(v / 1e4).toFixed(0)}만` : v.toLocaleString("ko-KR"));

export default function ChartMemo({ ticker, name, market, candles, minutes, memos, trades, levels, today, current, marks: savedMarks, doodles: savedDoodles }: {
  ticker: string; name: string; market: string; candles: Candle[]; minutes: MinuteCandle[]; memos: Memo[]; trades: Trade[]; levels: Level[]; today: string;
  current: number | null; marks: Mark[]; doodles: Doodle[];
}) {
  const [view, setView] = useState<View>("D");
  const intraday = !["D", "W", "M"].includes(view);
  const period: Period = intraday ? "D" : (view as Period);
  const [range, setRange] = useState<Range>("6m");
  const [show, setShow] = useState({ ma: true, bb: false, volume: true, rsi: false, trades: true, memos: true, levels: true });
  const [big, setBig] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const [pick, setPick] = useState<string>("");
  const [way, setWay] = useState<"above" | "below">("above");
  const [marks, setMarks] = useState<Mark[]>(savedMarks);
  const [doodles, setDoodles] = useState<Doodle[]>(savedDoodles);
  const [tool, setTool] = useState<Tool>("none");
  const [pending, setPending] = useState<number | null>(null);
  const [drawShown, setDrawShown] = useState(true);
  const [magnet, setMagnet] = useState(true);
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;
  const dragged = useRef(false); // 끌기가 막 끝났으면 그 클릭은 메모·알림 칸에 넣지 않아요
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const pendingRef = useRef<number | null>(pending);
  pendingRef.current = pending;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const drawRef = useRef<Drawings | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const live = useRef<{ px: [number, number][]; pts: DoodlePoint[] } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef<Range>(range);
  rangeRef.current = range;

  const fmt = (v: number) => (market === "US" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.round(v).toLocaleString("ko-KR"));
  const bars = useMemo<Bar[]>(() => {
    if (intraday) {
      const openSec = market === "US" ? 9.5 * 3600 : 9 * 3600;
      return aggregateMinutes(minutes, Number(view), openSec).map((b) => ({
        ...b, time: b.t as UTCTimestamp, key: String(b.t), label: hhmm(b.t), day: new Date(b.t * 1000).toISOString().slice(0, 10),
      }));
    }
    return aggregate(candles, period).map((c) => ({ ...c, time: c.day as Time, key: c.day, label: c.day }));
  }, [candles, minutes, view, intraday, period, market]);
  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const maValues = useMemo(() => MAS.map((m) => sma(closes, m.n)), [closes]);
  const bands = useMemo(() => bollinger(closes), [closes]);
  const memosByBar = useMemo(() => {
    const map = new Map<string, Memo[]>();
    if (intraday) return map;
    for (const m of memos) {
      const key = bucketOf(m.day, period);
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  }, [memos, period, intraday]);

  useEffect(() => {
    if (!box.current || bars.length < 2) return;
    let disposed = false;
    let chart: IChartApi | null = null;
    const el = box.current;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed) return;
      chart = lc.createChart(el, {
        autoSize: true,
        layout: {
          background: { type: lc.ColorType.Solid, color: "transparent" },
          textColor: MUTED, fontSize: 11, fontFamily: "'Pretendard Variable', Pretendard, sans-serif",
          attributionLogo: false,
          panes: { separatorColor: "#26262b", separatorHoverColor: "#2a2418" },
        },
        grid: { vertLines: { color: LINE }, horzLines: { color: LINE } },
        crosshair: {
          mode: lc.CrosshairMode.Normal,
          vertLine: { color: MUTED, labelBackgroundColor: "#2a2418" },
          horzLine: { color: MUTED, labelBackgroundColor: "#2a2418" },
        },
        rightPriceScale: { borderColor: "#26262b", scaleMargins: { top: 0.16, bottom: 0.06 } },
        timeScale: { borderColor: "#26262b", rightOffset: 4, minBarSpacing: 2, timeVisible: intraday, secondsVisible: false },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
      });
      chartRef.current = chart;

      const price = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
        priceLineColor: GOLD,
        priceFormat: { type: "custom", formatter: fmt, minMove: market === "US" ? 0.01 : 1 },
      });
      price.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
      priceRef.current = price;
      const drawings = new Drawings(new Map(bars.map((b, i) => [b.key, i])), fmt);
      price.attachPrimitive(drawings);
      drawRef.current = drawings;
      syncDrawings();

      if (show.ma) {
        MAS.forEach((m, k) => {
          const s = chart!.addSeries(lc.LineSeries, { color: m.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData(bars.flatMap((b, i) => (maValues[k][i] === null ? [] : [{ time: b.time, value: maValues[k][i]! }])));
        });
      }

      if (show.bb) {
        // 볼린저 밴드(20, 2): 위·아래 선은 실선, 가운데 20일선은 점선
        for (const [k, style] of [["upper", lc.LineStyle.Solid], ["mid", lc.LineStyle.Dashed], ["lower", lc.LineStyle.Solid]] as const) {
          const s = chart.addSeries(lc.LineSeries, { color: BAND, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData(bars.flatMap((b, i) => (bands[i] === null ? [] : [{ time: b.time, value: bands[i]![k] }])));
        }
      }

      let pane = 1;
      if (show.volume && bars.some((b) => b.volume)) {
        const vol = chart.addSeries(lc.HistogramSeries, { priceFormat: { type: "custom", formatter: compact }, priceLineVisible: false, lastValueVisible: false }, pane);
        vol.setData(bars.map((b, i) => ({
          time: b.time, value: b.volume ?? 0,
          color: (i === 0 ? b.close >= b.open : b.close >= bars[i - 1].close) ? "rgba(232,128,111,0.55)" : "rgba(134,168,230,0.55)",
        })));
        chart.panes()[pane].setStretchFactor(0.28);
        pane++;
      }
      if (show.rsi) {
        const r = rsi(closes);
        const s: ISeriesApi<"Line"> = chart.addSeries(lc.LineSeries, {
          color: GOLD, lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
          priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(0) },
        }, pane);
        s.setData(bars.flatMap((b, i) => (r[i] === null ? [] : [{ time: b.time, value: r[i]! }])));
        for (const v of [30, 70]) s.createPriceLine({ price: v, color: v === 30 ? DOWN : UP, lineWidth: 1, lineStyle: lc.LineStyle.Dotted, axisLabelVisible: false, title: "" });
        chart.panes()[pane].setStretchFactor(0.28);
      }

      if (show.levels) {
        for (const l of levels) {
          price.createPriceLine({ price: l.price, color: LEVEL[l.kind].color, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: LEVEL[l.kind].label });
        }
      }

      const index = new Map(bars.map((b, i) => [b.key, i]));
      const markers: SeriesMarker<Time>[] = [];
      const first = bars[0].day;
      if (show.trades && !intraday) {
        for (const t of trades) {
          if (t.day < first) continue;
          markers.push(t.side === "buy"
            ? { time: bucketOf(t.day, period) as Time, position: "belowBar", shape: "arrowUp", color: UP, text: "매수" }
            : { time: bucketOf(t.day, period) as Time, position: "aboveBar", shape: "arrowDown", color: DOWN, text: "매도" });
        }
      }
      if (show.memos) {
        for (const key of memosByBar.keys()) {
          if (key >= first && index.has(key)) markers.push({ time: key as Time, position: "aboveBar", shape: "circle", color: "#ece8df", size: 0.8 });
        }
      }
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      lc.createSeriesMarkers(price, markers);

      chart.subscribeCrosshairMove((p: MouseEventParams<Time>) => setHover(p.time ? index.get(String(p.time)) ?? null : null));
      chart.subscribeClick((p: MouseEventParams<Time>) => {
        if (dragged.current || toolRef.current === "move") {
          dragged.current = false;
          return;
        }
        const b = p.time === undefined ? undefined : bars[index.get(String(p.time)) ?? -1];
        if (b) setDay(b.day > today ? today : b.day);
        // 누른 높이의 가격을 알림 가격 칸에 넣습니다. 현재가보다 높으면 "위로", 낮으면 "아래로".
        const at = p.point ? price.coordinateToPrice(p.point.y) : null;
        if (at !== null && at > 0) {
          const v = tickRound(at, market);
          setPick(String(v));
          const ref = current ?? bars[bars.length - 1].close;
          setWay(v >= ref ? "above" : "below");
        }
      });
      applyRange(chart, bars, intraday ? "intraday" : rangeRef.current);
    })();
    return () => {
      disposed = true;
      chart?.remove();
      chartRef.current = null;
      drawRef.current = null;
      priceRef.current = null;
    };
    // fmt·period는 bars·market과 함께 바뀌므로 의존성에서 뺍니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, show, levels, trades, memosByBar, maValues, bands, closes, today, big, intraday]);

  useEffect(() => {
    if (chartRef.current) applyRange(chartRef.current, bars, intraday ? "intraday" : range);
  }, [range, bars, intraday]);

  const strokes = useMemo<Stroke[]>(() => doodles.filter((d) => d.view === view), [doodles, view]);
  function syncDrawings() {
    drawRef.current?.set({ marks: marksRef.current, strokes: strokesRef.current, visible: drawShownRef.current, pending: pendingRef.current });
  }
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const drawShownRef = useRef(drawShown);
  drawShownRef.current = drawShown;
  useEffect(() => {
    drawRef.current?.set({ marks, strokes, visible: drawShown, pending });
  }, [marks, strokes, drawShown, pending]);
  useEffect(() => {
    chartRef.current?.applyOptions({ handleScroll: tool !== "pen", handleScale: tool !== "pen" });
    if (tool !== "zone") setPending(null);
  }, [tool]);

  const ref = current ?? (bars.length ? bars[bars.length - 1].close : 0);
  const refPrice = useRef(ref);
  refPrice.current = ref;
  async function saveMark(low: number, high: number | null) {
    const kind = kindFor(low, high, ref);
    const id = await addLevel({ ticker, name, kind, low, high });
    if (id !== null) setMarks((m) => [...m, { id, kind, low, high, memo: "", alert: false, color: null }]);
  }
  function changeMark(id: number, change: Partial<Pick<Mark, "memo" | "alert" | "kind" | "color">>) {
    setMarks((ms) => ms.map((m) => (m.id === id ? { ...m, ...change } : m)));
    void updateLevel(id, change);
  }
  function removeMark(id: number) {
    setMarks((ms) => ms.filter((m) => m.id !== id));
    void deleteLevel(id);
  }
  // 선·구간·지우개 도구로 차트를 눌렀을 때
  function drawAt(v: number, x: number, y: number) {
    const t = toolRef.current;
    if (t === "line") {
      void saveMark(v, null);
      setTool("none");
    } else if (t === "zone") {
      const first = pendingRef.current;
      if (first === null) setPending(v);
      else if (first !== v) {
        const z = zone(first, v);
        void saveMark(z.low, z.high);
        setTool("none");
      }
    } else if (t === "eraser") {
      const d = drawRef.current;
      if (!d) return;
      const hit = strokesRef.current.find((s) => s.id !== null && strokeDistance([x, y], d.pixels(s.points)) <= 10);
      if (hit) {
        setDoodles((ds) => ds.filter((s) => s.id !== hit.id));
        void deleteDoodle(hit.id!);
        return;
      }
      const m = marksRef.current.find((mk) => {
        const top = d.y(mk.high ?? mk.low), bottom = d.y(mk.low);
        return top !== null && bottom !== null && y >= top - 6 && y <= bottom + 6;
      });
      if (m) removeMark(m.id);
    }
  }
  // 자석: 누른 자리 근처 캔들의 꼬리·몸통(시·고·저·종) 가격에 붙여요.
  // near가 있으면 그 봉 양옆 한 개씩을 먼저(넉넉하게), 없으면 화면에 보이는 봉 전체를(좁게) 봐요.
  function snapAt(y: number, x: number | null, raw: number): number {
    const chart = chartRef.current, price = priceRef.current;
    if (!magnetRef.current || !chart || !price || !bars.length) return tickRound(raw, market);
    const toY = (v: number) => price.priceToCoordinate(v);
    const ohlc = (from: number, to: number) => bars.slice(Math.max(0, from), Math.min(bars.length, to + 1)).flatMap((b) => [b.open, b.high, b.low, b.close]);
    const logical = x === null ? null : chart.timeScale().coordinateToLogical(x);
    if (logical !== null) {
      const i = Math.round(logical);
      const hit = snap(y, ohlc(i - 1, i + 1), toY, 14);
      if (hit !== null) return hit;
    }
    const range = chart.timeScale().getVisibleLogicalRange();
    const hit = range ? snap(y, ohlc(Math.floor(range.from), Math.ceil(range.to)), toY, 6) : null;
    return hit ?? tickRound(raw, market);
  }
  // 도구를 고른 동안은 차트 위에 얇은 막을 덮어 누른 자리를 직접 받아요(차트는 빠른 두 번 누름을 놓쳐서).
  function tap(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    const at = priceRef.current?.coordinateToPrice(y) ?? null;
    if (at !== null && at > 0) drawAt(toolRef.current === "eraser" ? at : snapAt(y, x, at), x, y);
  }

  // ↕ 옮기기 모드에서 선(구간이면 위·아래 끝)을 잡고 위아래로 끌면 옮겨져요.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // moved: 손 떨림보다 크게(마우스 4px, 손가락 8px) 움직였을 때만 진짜 끌기로 봐요. 그냥 누르면 선이 그대로예요.
    let drag: { id: number; edge: "low" | "high"; mark: Mark; startY: number; slop: number; moved: boolean } | null = null;
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const grab = (e: PointerEvent) => {
      const chart = chartRef.current, d = drawRef.current;
      // ↕ 옮기기 모드에서만 잡혀요. 보통 때 차트를 누르거나 끌면 선은 그대로예요.
      if (!chart || !d || toolRef.current !== "move" || !drawShownRef.current) return null;
      const [, y] = pos(e);
      const reach = e.pointerType === "touch" ? 16 : 9;
      let best: { id: number; edge: "low" | "high"; mark: Mark; gap: number } | null = null;
      for (const m of marksRef.current) {
        for (const edge of (m.high === null ? ["low"] : ["high", "low"]) as ("low" | "high")[]) {
          const ey = d.y(edge === "high" ? m.high! : m.low);
          if (ey === null) continue;
          const gap = Math.abs(ey - y);
          if (gap <= reach && (!best || gap < best.gap)) best = { id: m.id, edge, mark: m, gap };
        }
      }
      return best;
    };
    const down = (e: PointerEvent) => {
      const g = grab(e);
      if (!g) return;
      drag = { id: g.id, edge: g.edge, mark: g.mark, startY: pos(e)[1], slop: e.pointerType === "touch" ? 8 : 4, moved: false };
      e.preventDefault();
      e.stopPropagation();
      chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) {
        el.style.cursor = grab(e) ? "ns-resize" : "";
        return;
      }
      const [x, y] = pos(e);
      if (!drag.moved && Math.abs(y - drag.startY) < drag.slop) return;
      drag.moved = true;
      const raw = priceRef.current?.coordinateToPrice(y) ?? null;
      if (raw === null || raw <= 0) return;
      drag.mark = moveEdge(drag.mark, drag.edge, snapAt(y, x, raw));
      if (drag.mark.high !== null && drag.edge === "high" && drag.mark.high < drag.mark.low) drag.edge = "low";
      const next = marksRef.current.map((m) => (m.id === drag!.id ? drag!.mark : m));
      marksRef.current = next;
      drawRef.current?.set({ marks: next });
    };
    const up = () => {
      if (!drag) return;
      if (!drag.moved) {
        drag = null;
        chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }
      const m = drag.mark;
      // 구간 끝을 서로 넘겨 끌었을 수 있어서, 위·아래는 저장 전에 다시 맞춰요.
      const fixed = m.high === null ? m : { ...m, low: Math.min(m.low, m.high), high: Math.max(m.low, m.high) };
      const kind = kindFor(fixed.low, fixed.high, refPrice.current);
      drag = null;
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 400);
      chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
      setMarks((ms) => ms.map((x) => (x.id === fixed.id ? { ...fixed, kind } : x)));
      void updateLevel(fixed.id, { low: fixed.low, high: fixed.high, kind });
    };
    // 폰에서 끄는 동안 화면이 같이 스크롤되지 않게
    const touch = (e: TouchEvent) => drag && e.preventDefault();
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("touchstart", touch, { capture: true, passive: false });
    el.addEventListener("touchmove", touch, { capture: true, passive: false });
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("touchstart", touch, true);
      el.removeEventListener("touchmove", touch, true);
    };
    // 상태는 ref로 읽어서, 차트 상자가 바뀔 때만 다시 붙입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars.length >= 2, big]);
  // 낙서: 누른 자리(화면 좌표)를 봉 키·봉 안 위치·가격으로 바꿔 둡니다.
  function toPoint(x: number, y: number): DoodlePoint | null {
    const chart = chartRef.current, price = priceRef.current;
    if (!chart || !price || !bars.length) return null;
    const logical = chart.timeScale().coordinateToLogical(x);
    const p = price.coordinateToPrice(y);
    if (logical === null || p === null || p <= 0) return null;
    const i = Math.max(0, Math.min(bars.length - 1, Math.round(logical)));
    return [bars[i].key, Math.round((logical - i) * 1000) / 1000, Number(p.toPrecision(8))];
  }
  function penDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current = { px: [], pts: [] };
    penMove(e);
  }
  function penMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!live.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    const pt = toPoint(x, y);
    if (!pt) return;
    live.current.px.push([x, y]);
    live.current.pts.push(pt);
    drawRef.current?.set({ strokes: [...strokesRef.current, { id: null, color: PEN, points: live.current.pts }] });
  }
  async function penUp() {
    const cur = live.current;
    live.current = null;
    if (!cur || !cur.pts.length) return;
    const points = thin(cur.px).map((i) => cur.pts[i]);
    const id = await addDoodle({ ticker, view, color: PEN, points });
    if (id !== null) setDoodles((ds) => [...ds, { id, view, color: PEN, points }]);
    else syncDrawings();
  }

  useEffect(() => {
    if (!big) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [big]);

  const i = hover ?? bars.length - 1;
  const bar = bars[i];
  const prev = i > 0 ? bars[i - 1] : null;
  const barMemos = bar ? memosByBar.get(bar.key) ?? [] : [];
  const near = nearest(marks, ref);
  const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <>
      <div className={big ? "chart-wrap big" : "chart-wrap"}>
        <div className="chart-tools">
          <div className="segment small views">
            {VIEWS.map((v) => <button key={v.key} type="button" aria-selected={view === v.key} onClick={() => setView(v.key)}>{v.label}</button>)}
          </div>
          <div className={intraday ? "segment small hidden" : "segment small"}>
            {RANGES.map((r) => <button key={r.key} type="button" aria-selected={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>)}
          </div>
          <div className="chart-toggles">
            {([["ma", "이동평균"], ["bb", "볼린저"], ["volume", "거래량"], ["rsi", "RSI"], ["trades", "매매"], ["levels", "평단·손절·알림"], ["memos", "메모"]] as const).map(([k, label]) => (
              <button key={k} type="button" className={show[k] ? "chip-btn on" : "chip-btn"} aria-pressed={show[k]} onClick={() => toggle(k)}>{label}</button>
            ))}
            <button type="button" className="chip-btn" onClick={() => setBig((b) => !b)}>{big ? "닫기 ✕" : "크게 보기"}</button>
          </div>
          <div className="chart-toggles draw-tools">
            {TOOLS.map((t) => (
              <button key={t.key} type="button" className={tool === t.key ? "chip-btn on" : "chip-btn"} aria-pressed={tool === t.key}
                onClick={() => { setTool(tool === t.key ? "none" : t.key); setDrawShown(true); }}>{t.label}</button>
            ))}
            <button type="button" className={magnet ? "chip-btn on" : "chip-btn"} aria-pressed={magnet} title="캔들 꼬리·몸통에 붙이기"
              onClick={() => setMagnet((v) => !v)}>🧲 자석</button>
            <button type="button" className={drawShown ? "chip-btn" : "chip-btn on"} aria-pressed={!drawShown} onClick={() => setDrawShown((v) => !v)}>
              {drawShown ? "그림 숨기기" : "그림 보이기"}
            </button>
            {near.above && <span className="near" style={{ color: RESIST, borderColor: RESIST }}>저항 {fmt(near.above.mark.low)}까지 {signed(near.above.pct)}</span>}
            {near.below && <span className="near" style={{ color: SUPPORT, borderColor: SUPPORT }}>지지 {fmt(near.below.mark.high ?? near.below.mark.low)}까지 {signed(near.below.pct)}</span>}
          </div>
        </div>

        {bars.length < 2 ? (
          <p className="muted chart-empty">
            {intraday
              ? "아직 분봉이 없어요. 장이 열려 있는 동안 워커가 2분마다 1분봉을 받아 오고, 최근 8일치를 보관해요."
              : "아직 가격 기록이 없습니다. 워커가 다음 수집 때(최대 12시간) 일봉을 받아 오고, 그 뒤로는 매일 종가가 쌓입니다."}
          </p>
        ) : (
          <div className="chart-box">
            <div className="chart-legend">
              <div>
                <span className="muted">{bar.label}{view === "W" ? " 주" : view === "M" ? " 월" : ""}</span>
                <span><i>시</i>{fmt(bar.open)}</span>
                <span><i>고</i><b className="up">{fmt(bar.high)}</b></span>
                <span><i>저</i><b className="down">{fmt(bar.low)}</b></span>
                <span><i>종</i><b>{fmt(bar.close)}</b></span>
                {prev && <span className={bar.close >= prev.close ? "up" : "down"}>{signed((bar.close / prev.close - 1) * 100)}</span>}
                {bar.volume !== null && <span><i>거래량</i>{compact(bar.volume)}</span>}
              </div>
              {show.ma && (
                <div>
                  {MAS.map((m, k) => maValues[k][i] !== null && (
                    <span key={m.n} style={{ color: m.color }}>{m.n}{intraday ? "봉" : "일"} {fmt(maValues[k][i]!)}</span>
                  ))}
                </div>
              )}
              {show.bb && bands[i] && (
                <div>
                  <span style={{ color: BAND }}>볼린저(20, 2) 위 {fmt(bands[i]!.upper)} · 가운데 {fmt(bands[i]!.mid)} · 아래 {fmt(bands[i]!.lower)}</span>
                </div>
              )}
              {barMemos.map((m) => <div key={m.id} className="tip-memo">{md(m.day)} {m.body}</div>)}
            </div>
            <div className="chart-stage">
              <div ref={box} className={show.rsi ? "chart-canvas tall" : "chart-canvas"} />
              {tool === "pen" && (
                <div className="pen-layer" onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp} />
              )}
              {(tool === "line" || tool === "zone" || tool === "eraser") && <div className="pen-layer" onPointerUp={tap} />}
              {tool !== "none" && (
                <div className="draw-hint">
                  {tool === "zone" && pending !== null ? `${fmt(pending)}을 골랐어요. 이제 구간의 다른 끝을 누르세요.` : TOOLS.find((t) => t.key === tool)!.hint}
                </div>
              )}
            </div>
          </div>
        )}
        <p className="chart-foot">
          휠이나 두 손가락으로 확대하고, 끌어서 옮겨요. 차트를 누르면 그 날짜는 메모 칸에, 그 높이의 가격은 알림 칸에 들어가요. 지지·저항은 모든 차트에, 낙서는 그린 차트에만 보여요. 선·구간은 ↕ 옮기기를 켜고 잡아 끌면 옮겨지고, 🧲 자석이 켜져 있으면 캔들 꼬리·몸통에 붙어요. 차트:{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts
        </p>
      </div>

      {marks.length > 0 && (
        <div className="list levels-list">
          <div className="muted levels-head">내가 그린 지지·저항 · 🔔를 켜 두면 가격이 닿을 때 텔레그램으로 알려요</div>
          {[...marks].sort((a, b) => (b.high ?? b.low) - (a.high ?? a.low)).map((m) => (
            <div key={m.id} className="list-item level-row">
              <span className={m.high === null ? "sw line" : "sw"} style={{ background: markColor(m) }} />
              <button type="button" className="ghost level-kind" style={{ color: markColor(m) }} title="눌러서 지지/저항 바꾸기"
                onClick={() => changeMark(m.id, { kind: m.kind === "support" ? "resistance" : "support" })}>{KIND_LABEL[m.kind]}</button>
              <span className="num">{m.high === null ? fmt(m.low) : `${fmt(m.low)} ~ ${fmt(m.high)}`}</span>
              <span className="level-colors" role="radiogroup" aria-label="색">
                {COLORS.map((c) => (
                  <button key={c.label} type="button" role="radio" aria-checked={m.color === c.value} title={c.label}
                    className={m.color === c.value ? "dot on" : "dot"} style={{ background: c.value ?? markColor({ kind: m.kind, color: null }) }}
                    onClick={() => changeMark(m.id, { color: c.value })}>{c.value === null ? "기" : ""}</button>
                ))}
              </span>
              <input className="level-memo" defaultValue={m.memo} placeholder="메모 (예: 전고점)" maxLength={100}
                onBlur={(e) => e.target.value.trim() !== m.memo && changeMark(m.id, { memo: e.target.value.trim() })} />
              <button type="button" className={m.alert ? "chip-btn on" : "chip-btn"} aria-pressed={m.alert} onClick={() => changeMark(m.id, { alert: !m.alert })}>
                {m.alert ? "🔔 알림 켜짐" : "🔕 알림 꺼짐"}
              </button>
              <button type="button" className="ghost" onClick={() => removeMark(m.id)}>지우기</button>
            </div>
          ))}
        </div>
      )}

      <form action={addAlert} className="memo-form alert-form" onSubmit={() => setTimeout(() => setPick(""), 0)}>
        <input type="hidden" name="ticker" value={ticker} />
        <input type="hidden" name="name" value={name} />
        <div className="segment" role="radiogroup" aria-label="알림 방향">
          {(["above", "below"] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-selected={way === w} aria-checked={way === w} onClick={() => setWay(w)}>
              {w === "above" ? "위로 가면" : "아래로 가면"}
            </button>
          ))}
        </div>
        <input type="hidden" name="direction" value={way} />
        <input name="price" inputMode="decimal" placeholder="알림 가격 (차트를 눌러도 돼요)" value={pick} onChange={(e) => setPick(e.target.value)} required />
        <input name="memo" placeholder="메모 (선택)" maxLength={200} />
        <button type="submit">텔레그램 알림 만들기</button>
      </form>

      <form action={addChartMemo} className="row memo-form">
        <input type="hidden" name="ticker" value={ticker} />
        <input type="date" name="day" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
        <input name="body" placeholder="이 날 무슨 생각을 했나요? (예: 실적 발표 후 급락, 분할매수 시작)" maxLength={500} required />
        <button type="submit">메모 남기기</button>
      </form>

      {memos.length > 0 && (
        <div className="list">
          {memos.map((m) => (
            <form key={m.id} action={deleteChartMemo} className="list-item">
              <input type="hidden" name="ticker" value={ticker} />
              <input type="hidden" name="id" value={m.id} />
              <span><span className="chip">{md(m.day)}</span> {m.body}</span>
              <button type="submit" className="ghost">삭제</button>
            </form>
          ))}
        </div>
      )}
    </>
  );
}

function applyRange(chart: IChartApi, bars: Bar[], range: Range | "intraday") {
  if (range === "intraday") {
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - MINUTE_BARS_SHOWN) - 0.5, to: bars.length - 1 + 4 });
    return;
  }
  const months = RANGES.find((r) => r.key === range)!.months;
  if (!months || bars.length < 2) {
    chart.timeScale().fitContent();
    return;
  }
  const from = new Date(`${bars[bars.length - 1].day}T00:00:00Z`);
  from.setUTCMonth(from.getUTCMonth() - months);
  const start = bars.findIndex((b) => b.day >= from.toISOString().slice(0, 10));
  // 기간보다 봉이 적으면(월봉 3개월 등) 최소 12개는 보이게 합니다.
  const fromIndex = Math.max(0, Math.min(start, bars.length - 12));
  chart.timeScale().setVisibleLogicalRange({ from: fromIndex - 0.5, to: bars.length - 1 + 4 });
}
