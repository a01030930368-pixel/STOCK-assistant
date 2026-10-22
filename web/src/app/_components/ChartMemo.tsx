"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { addAlert, addChartMemo, addDoodle, addLevel, addShape, deleteChartMemo, deleteDoodle, deleteLevel, deleteShape, updateLevel, updateShape } from "@/app/actions";
import {
  COLORS, fibPrices, KIND_LABEL, kindFor, markColor, measure, moveEdge, nearest, segmentDistance, SHAPE_LABEL, SHAPE_POINTS, snap, strokeDistance, thin, zone,
  type Doodle, type DoodlePoint, type Mark, type Shape, type ShapeKind,
} from "@/lib/drawings";
import { Drawings, RESIST, SUPPORT, type Stroke } from "./chartDrawings";
import BandChart from "./BandChart";
import type { BandKind } from "@/lib/bands";
import type { StatementRow } from "@/lib/statements";
import { aggregate, aggregateMinutes, bollinger, bucketOf, MINUTES, rsi, sma, type Candle, type MinuteCandle, type Period } from "@/lib/candles";
import { cleanSettings, DEFAULTS, divergences, ichimoku, macd, obv, PATTERNS, patterns, stochastic, vwap, type Settings } from "@/lib/indicators";
import { Overlay } from "./chartOverlays";

export type { Candle, MinuteCandle };
export type Memo = { id: number; day: string; body: string };
export type Trade = { day: string; side: "buy" | "sell"; price: number; quantity: number };
export type Level = { kind: "avg" | "stop" | "target" | "alert"; price: number };
export type { Doodle, Mark, Shape };
type Tool = "none" | "line" | "trend" | "channel" | "zone" | "fib" | "ruler" | "move" | "pen" | "eraser";
// 왼쪽 막대에서 선 칸(가로선·추세선·평행 채널)은 하나로 묶고, 누르면 옆으로 펼쳐져요.
const LINE_TOOLS: { key: Tool; name: string; icon: string }[] = [
  { key: "line", name: "가로선", icon: "—" }, { key: "trend", name: "추세선", icon: "／" }, { key: "channel", name: "평행 채널", icon: "⫽" },
];
const isLine = (t: Tool) => t === "line" || t === "trend" || t === "channel";
const TOOLS: { key: Tool; name: string; icon: string; hint: string }[] = [
  { key: "line", name: "가로선", icon: "—", hint: "차트에서 원하는 높이를 한 번 누르세요. 지금 가격보다 위면 저항, 아래면 지지예요." },
  { key: "trend", name: "추세선", icon: "／", hint: "선의 시작점과 끝점을 차례로 누르세요. 선은 끝점 너머로 길게 이어져요." },
  { key: "channel", name: "평행 채널", icon: "⫽", hint: "추세선의 두 점을 누른 뒤, 평행선이 지나갈 자리를 한 번 더 누르세요." },
  { key: "fib", name: "피보나치", icon: "Fib", hint: "시작점(예: 저점)과 끝점(예: 고점)을 차례로 누르세요. 그 사이 23.6·38.2·50·61.8·78.6% 선이 생겨요." },
  { key: "ruler", name: "자", icon: "📏", hint: "재고 싶은 두 점을 차례로 누르세요. 등락률, 봉 수, 날짜 수가 보여요. 저장은 안 돼요." },
  { key: "zone", name: "구간", icon: "▭", hint: "구간의 위·아래를 차례로 한 번씩 누르세요." },
  { key: "move", name: "옮기기", icon: "↕", hint: "옮길 선이나 구간의 위·아래 끝을 잡고 위아래로 끄세요. 다 옮겼으면 ↕ 옮기기를 다시 눌러 끝내요." },
  { key: "pen", name: "낙서", icon: "✎", hint: "손가락이나 마우스로 그리세요. 낙서는 이 차트에서만 보여요. 다 그렸으면 ✎ 낙서를 다시 눌러 끝내요." },
  { key: "eraser", name: "지우개", icon: "⌫", hint: "지울 낙서나 선을 누르세요." },
];
const PEN = "#e7cf9c";
// 오른쪽 위 "지표" 메뉴. over = 차트 위에 겹치기, pane = 아래 칸, auto = 자동으로 찾아 표시
type IndKey = "ma" | "bb" | "ichimoku" | "vwap" | "vp" | "volume" | "rsi" | "macd" | "stoch" | "obv" | "patterns" | "divergence";
type EditKey = "ma" | "bb" | "rsi" | "macd" | "stoch";
const INDICATORS: { key: IndKey; group: "over" | "pane" | "auto"; name: string; note?: (s: Settings) => string; edit?: EditKey }[] = [
  { key: "ma", group: "over", name: "이동평균", note: (s) => s.ma.join("·"), edit: "ma" },
  { key: "bb", group: "over", name: "볼린저 밴드", note: (s) => s.bb.join(", "), edit: "bb" },
  { key: "ichimoku", group: "over", name: "일목균형표", note: () => "9·26·52" },
  { key: "vwap", group: "over", name: "VWAP" },
  { key: "vp", group: "over", name: "매물대" },
  { key: "volume", group: "pane", name: "거래량" },
  { key: "rsi", group: "pane", name: "RSI", note: (s) => String(s.rsi), edit: "rsi" },
  { key: "macd", group: "pane", name: "MACD", note: (s) => s.macd.join("·"), edit: "macd" },
  { key: "stoch", group: "pane", name: "스토캐스틱", note: (s) => s.stoch.join("·"), edit: "stoch" },
  { key: "obv", group: "pane", name: "OBV" },
  { key: "patterns", group: "auto", name: "캔들 패턴" },
  { key: "divergence", group: "auto", name: "RSI 다이버전스" },
];
const GROUPS = [["over", "차트 위에 겹치기"], ["pane", "아래 칸 · 거래량 말고 2개까지"], ["auto", "자동으로 찾아 표시"]] as const;
const PANES: IndKey[] = ["rsi", "macd", "stoch", "obv"];
const MAX_PANES = 2;
// 숫자 바꾸기 칸: [설정 안 몇 번째, 이름]
const FIELDS: Record<EditKey, string[]> = { ma: ["1", "2", "3", "4"], bb: ["기간", "배수"], rsi: ["기간"], macd: ["빠른 선", "느린 선", "신호"], stoch: ["기간", "평균"] };
const SAVE_KEY = "chart-indicators-v1";
const SHOWS = [["trades", "산 날·판 날", ""], ["levels", "평단·손절·알림 선", ""], ["memos", "메모", ""], ["drawings", "내가 그린 선·낙서", ""]] as const;

const UP = "#e8806f", DOWN = "#86a8e6", GOLD = "#c9a96b", MUTED = "#9b968b", LINE = "#1b1b1f", BAND = "#a7a08f";
const MA_COLORS = [GOLD, "#b48ead", "#7fb8a4", "#8a857b"];
const SIGNAL = "#6fa8d9", TENKAN = "#d98f6f", KIJUN = "#6fa8d9", VWAP = "#d98fd0", DIVERGE = "#d9b45a";
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
const compact = (v: number): string => (v < 0 ? `−${compact(-v)}` : v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${(v / 1e4).toFixed(0)}만` : v.toLocaleString("ko-KR"));

export default function ChartMemo({ ticker, name, market, candles, minutes, memos, trades, levels, today, current, marks: savedMarks, doodles: savedDoodles, statements = [], shares = null, shapes: savedShapes = [], practice }: {
  ticker: string; name: string; market: string; candles: Candle[]; minutes: MinuteCandle[]; memos: Memo[]; trades: Trade[]; levels: Level[]; today: string;
  current: number | null; marks: Mark[]; doodles: Doodle[]; statements?: StatementRow[]; shares?: number | null; shapes?: Shape[];
  // 연습하기: 그린 것은 저장하지 않고 이 화면에서만 써요. blind면 날짜·가격대를 가려요.
  practice?: { blind: boolean };
}) {
  const local = useRef(-1); // 연습하기에서 그린 것의 임시 번호
  const nextLocal = () => local.current--;
  const tickMarket = practice?.blind ? "US" : market;
  const [mode, setMode] = useState<"price" | BandKind>("price");
  const [menu, setMenu] = useState<null | "ind" | "show">(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  // 메뉴 밖을 누르면 접어요.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!toolsRef.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const [view, setView] = useState<View>("D");
  const intraday = !["D", "W", "M"].includes(view);
  const period: Period = intraday ? "D" : (view as Period);
  const [range, setRange] = useState<Range>("6m");
  const [show, setShow] = useState<Record<IndKey | "trades" | "memos" | "levels", boolean>>({
    ma: true, bb: false, ichimoku: false, vwap: false, vp: false, volume: true, rsi: false, macd: false, stoch: false, obv: false,
    patterns: false, divergence: false, trades: true, memos: true, levels: true,
  });
  const [order, setOrder] = useState<IndKey[]>([]); // 아래 칸을 켠 순서. 3번째를 켜면 가장 먼저 켠 칸이 꺼져요
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [edit, setEdit] = useState<EditKey | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 켜 둔 지표와 숫자는 이 기기(브라우저)에 기억해요. 종목을 바꿔도 같아요.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
      if (saved) {
        const keys = INDICATORS.map((d) => d.key);
        setShow((s) => ({ ...s, ...Object.fromEntries(keys.filter((k) => typeof saved.show?.[k] === "boolean").map((k) => [k, saved.show[k]])) }));
        setSettings(cleanSettings(saved.settings));
        if (Array.isArray(saved.order)) setOrder(saved.order.filter((k: IndKey) => PANES.includes(k)));
      }
    } catch { /* 저장 공간을 못 쓰면 기본값으로 */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ show: Object.fromEntries(INDICATORS.map((d) => [d.key, show[d.key]])), settings, order }));
    } catch { /* 무시 */ }
  }, [show, settings, order, loaded]);
  const [big, setBig] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const [pick, setPick] = useState<string>("");
  const [way, setWay] = useState<"above" | "below">("above");
  const [marks, setMarks] = useState<Mark[]>(savedMarks);
  const [doodles, setDoodles] = useState<Doodle[]>(savedDoodles);
  const [tool, setTool] = useState<Tool>("none");
  const [lineTool, setLineTool] = useState<Tool>("line");
  const [lineOpen, setLineOpen] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>(savedShapes);
  const [draft, setDraft] = useState<DoodlePoint[]>([]); // 추세선·채널·피보나치·자에서 지금까지 누른 점
  const [ruler, setRuler] = useState<{ a: DoodlePoint; b: DoodlePoint; text: string } | null>(null);
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

  const fmt = (v: number) => (practice?.blind ? v.toFixed(2) : market === "US" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.round(v).toLocaleString("ko-KR"));
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
  const maValues = useMemo(() => settings.ma.map((n) => sma(closes, n)), [closes, settings.ma]);
  const bands = useMemo(() => bollinger(closes, settings.bb[0], settings.bb[1]), [closes, settings.bb]);
  const rsiValues = useMemo(() => rsi(closes, settings.rsi), [closes, settings.rsi]);
  const macdValues = useMemo(() => macd(closes, ...settings.macd), [closes, settings.macd]);
  const stochValues = useMemo(() => stochastic(bars, ...settings.stoch), [bars, settings.stoch]);
  const obvValues = useMemo(() => obv(bars), [bars]);
  const patternAt = useMemo(() => new Map(patterns(bars).map((p) => [p.i, p.key])), [bars]);
  const divs = useMemo(() => divergences(bars, rsiValues), [bars, rsiValues]);
  // 일·주·월봉 VWAP은 고른 기간의 첫 봉부터 쌓아요. 분봉은 날마다 새로 쌓아요.
  const vwapFrom = useMemo(() => (show.vwap && !intraday ? rangeStart(bars, range) : 0), [show.vwap, intraday, bars, range]);
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
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd", ...(practice?.blind ? { timeFormatter: () => "" } : {}) },
      });
      if (practice?.blind) chart.applyOptions({ timeScale: { tickMarkFormatter: () => "" } });
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

      const line = (color: string, pane = 0, width: 1 | 2 = 1) =>
        chart!.addSeries(lc.LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      const overlay = new Overlay();
      price.attachPrimitive(overlay);
      if (show.ma) {
        settings.ma.forEach((_, k) => {
          const s = line(MA_COLORS[k]);
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

      if (show.ichimoku) {
        const k = ichimoku(bars);
        for (const [vals, color] of [[k.tenkan, TENKAN], [k.kijun, KIJUN]] as const) {
          line(color).setData(bars.flatMap((b, i) => (vals[i] === null ? [] : [{ time: b.time, value: vals[i]! }])));
        }
        overlay.set({ cloud: { a: k.spanA, b: k.spanB, shift: k.shift } });
      }
      if (show.vwap && bars.some((b) => b.volume)) {
        const v = vwap(bars, intraday ? (i) => bars[i].day : () => "", vwapFrom);
        line(VWAP, 0, 2).setData(bars.flatMap((b, i) => (v[i] === null ? [] : [{ time: b.time, value: v[i]! }])));
      }
      if (show.vp && bars.some((b) => b.volume)) overlay.set({ profile: bars });
      const shownDivs = show.divergence ? divs.slice(-6) : [];
      overlay.set({
        segments: shownDivs.map((d) => d.kind === "bear"
          ? { a: d.a, b: d.b, pa: bars[d.a].high, pb: bars[d.b].high, color: DIVERGE, label: "하락 다이버전스" }
          : { a: d.a, b: d.b, pa: bars[d.a].low, pb: bars[d.b].low, color: DIVERGE, label: "상승 다이버전스" }),
      });

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
      const guides = (s: ISeriesApi<"Line">, lo: number, hi: number) => {
        for (const v of [lo, hi]) s.createPriceLine({ price: v, color: v === lo ? DOWN : UP, lineWidth: 1, lineStyle: lc.LineStyle.Dotted, axisLabelVisible: false, title: "" });
      };
      const whole = { type: "custom" as const, formatter: (v: number) => v.toFixed(0) };
      for (const key of PANES) {
        if (!show[key]) continue;
        if (key === "rsi") {
          const s: ISeriesApi<"Line"> = chart.addSeries(lc.LineSeries, { color: GOLD, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: whole }, pane);
          s.setData(bars.flatMap((b, i) => (rsiValues[i] === null ? [] : [{ time: b.time, value: rsiValues[i]! }])));
          guides(s, 30, 70);
          if (shownDivs.length) {
            const o = new Overlay();
            s.attachPrimitive(o);
            o.set({ segments: shownDivs.map((d) => ({ a: d.a, b: d.b, pa: rsiValues[d.a]!, pb: rsiValues[d.b]!, color: DIVERGE })) });
          }
        } else if (key === "macd") {
          const hist = chart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }, pane);
          hist.setData(bars.flatMap((b, i) => (macdValues[i] === null ? [] : [{
            time: b.time, value: macdValues[i]!.hist, color: macdValues[i]!.hist >= 0 ? "rgba(232,128,111,0.5)" : "rgba(134,168,230,0.5)",
          }])));
          for (const [k, color] of [["macd", GOLD], ["signal", SIGNAL]] as const) {
            line(color, pane).setData(bars.flatMap((b, i) => (macdValues[i] === null ? [] : [{ time: b.time, value: macdValues[i]![k] }])));
          }
        } else if (key === "stoch") {
          const k = line(GOLD, pane);
          k.applyOptions({ priceFormat: whole });
          k.setData(bars.flatMap((b, i) => (stochValues[i] === null ? [] : [{ time: b.time, value: stochValues[i]!.k }])));
          line(SIGNAL, pane).setData(bars.flatMap((b, i) => (stochValues[i] === null ? [] : [{ time: b.time, value: stochValues[i]!.d }])));
          guides(k, 20, 80);
        } else {
          const s = chart.addSeries(lc.LineSeries, { color: "#7fb8a4", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "custom", formatter: compact } }, pane);
          s.setData(bars.map((b, i) => ({ time: b.time, value: obvValues[i] })));
        }
        chart.panes()[pane].setStretchFactor(0.28);
        pane++;
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
      if (show.patterns) {
        for (const [i, key] of patternAt) {
          const p = PATTERNS[key];
          markers.push({
            time: bars[i].time, position: p.bull ? "belowBar" : "aboveBar", shape: p.bull === null ? "circle" : p.bull ? "arrowUp" : "arrowDown",
            color: p.bull === null ? MUTED : p.bull ? UP : DOWN, text: p.name, size: 0.6,
          });
        }
      }
      markers.sort((a, b) => (typeof a.time === "number" && typeof b.time === "number" ? a.time - b.time : String(a.time).localeCompare(String(b.time))));
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
          const v = tickRound(at, tickMarket);
          setPick(String(v));
          const ref = current ?? bars[bars.length - 1].close;
          setWay(v >= ref ? "above" : "below");
        }
      });
      const kept = keep.current;
      if (practice && kept && kept.view === view) {
        // 연습하기: 봉이 하나 늘 때마다 차트를 새로 그리는데, 보던 자리는 그대로 두고 오른쪽 끝을 보고 있었으면 한 칸 따라가요.
        const shift = kept.range.to >= kept.len - 1 ? bars.length - kept.len : 0;
        chart.timeScale().setVisibleLogicalRange({ from: kept.range.from + shift, to: kept.range.to + shift });
      } else applyRange(chart, bars, intraday ? "intraday" : rangeRef.current);
    })();
    return () => {
      disposed = true;
      const r = chart?.timeScale().getVisibleLogicalRange();
      if (r) keep.current = { range: { from: r.from, to: r.to }, len: bars.length, view };
      chart?.remove();
      chartRef.current = null;
      drawRef.current = null;
      priceRef.current = null;
    };
    // fmt·period는 bars·market과 함께 바뀌므로 의존성에서 뺍니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, show, levels, trades, memosByBar, maValues, bands, closes, today, big, intraday, mode, settings, rsiValues, macdValues, stochValues, obvValues, patternAt, divs, vwapFrom]);

  const keep = useRef<{ range: { from: number; to: number }; len: number; view: View } | null>(null);
  const lastRange = useRef(range);
  useEffect(() => {
    // 연습하기에서는 봉이 늘어도 보던 자리를 지켜요. 기간 단추를 눌렀을 때만 맞춰요.
    if (practice && lastRange.current === range) return;
    lastRange.current = range;
    if (chartRef.current) applyRange(chartRef.current, bars, intraday ? "intraday" : range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, bars, intraday]);

  const strokes = useMemo<Stroke[]>(() => doodles.filter((d) => d.view === view), [doodles, view]);
  function syncDrawings() {
    drawRef.current?.set({ marks: marksRef.current, strokes: strokesRef.current, visible: drawShownRef.current, pending: pendingRef.current, shapes: shapesRef.current });
  }
  const viewShapes = useMemo(() => shapes.filter((x) => x.view === view), [shapes, view]);
  const shapesRef = useRef(viewShapes);
  shapesRef.current = viewShapes;
  useEffect(() => {
    drawRef.current?.set({ shapes: viewShapes });
  }, [viewShapes]);
  useEffect(() => {
    drawRef.current?.set({ ruler });
  }, [ruler]);
  // 도구를 바꾸면 그리던 점은 버려요. 자는 다른 도구를 고르면 지워져요.
  useEffect(() => {
    setDraft([]);
    drawRef.current?.set({ draft: null });
    if (tool !== "ruler") setRuler(null);
  }, [tool, view]);
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
    const id = practice ? nextLocal() : await addLevel({ ticker, name, kind, low, high });
    if (id !== null) setMarks((m) => [...m, { id, kind, low, high, memo: "", alert: false, color: null }]);
  }
  function changeMark(id: number, change: Partial<Pick<Mark, "memo" | "alert" | "kind" | "color">>) {
    setMarks((ms) => ms.map((m) => (m.id === id ? { ...m, ...change } : m)));
    if (!practice) void updateLevel(id, change);
  }
  function removeMark(id: number) {
    setMarks((ms) => ms.filter((m) => m.id !== id));
    if (!practice) void deleteLevel(id);
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
        if (!practice) void deleteDoodle(hit.id!);
        return;
      }
      const sh = shapesRef.current.find((one) => shapeDistance(d, one, [x, y]) <= 8);
      if (sh) {
        setShapes((ss) => ss.filter((v) => v.id !== sh.id));
        if (!practice) void deleteShape(sh.id);
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
    if (!magnetRef.current || !chart || !price || !bars.length) return tickRound(raw, tickMarket);
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
    return hit ?? tickRound(raw, tickMarket);
  }
  // 도구를 고른 동안은 차트 위에 얇은 막을 덮어 누른 자리를 직접 받아요(차트는 빠른 두 번 누름을 놓쳐서).
  function tap(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    const at = priceRef.current?.coordinateToPrice(y) ?? null;
    if (at !== null && at > 0) drawAt(toolRef.current === "eraser" ? at : snapAt(y, x, at), x, y);
  }

  // 추세선·채널·피보나치·자: 누른 자리를 점으로(자석이 켜져 있으면 캔들 꼬리·몸통 가격에 붙여요).
  function pointAt(e: React.PointerEvent<HTMLDivElement>): DoodlePoint | null {
    const r = e.currentTarget.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    const pt = toPoint(x, y);
    if (!pt) return null;
    return [pt[0], pt[1], snapAt(y, x, pt[2])];
  }
  function rulerText(a: DoodlePoint, b: DoodlePoint): string {
    const at = (p: DoodlePoint) => {
      const i = bars.findIndex((x) => x.key === p[0]);
      return { price: p[2], index: i + p[1], day: bars[Math.max(0, i)].day };
    };
    return measure(at(a), at(b));
  }
  function hoverShape(e: React.PointerEvent<HTMLDivElement>) {
    const t = toolRef.current;
    if (t === "ruler") {
      if (ruler && draft.length === 1) {
        const b = pointAt(e);
        if (b) drawRef.current?.set({ ruler: { a: draft[0], b, text: rulerText(draft[0], b) } });
      }
      return;
    }
    if (!draft.length) return;
    const p = pointAt(e);
    if (p) drawRef.current?.set({ draft: { kind: t as ShapeKind, points: [...draft, p] } });
  }
  async function tapShape(e: React.PointerEvent<HTMLDivElement>) {
    const t = toolRef.current;
    const p = pointAt(e);
    if (!p) return;
    if (t === "ruler") {
      // 첫 점 → 둘째 점에서 멈춤 → 다시 누르면 새로 재기
      if (draft.length === 1) {
        setRuler({ a: draft[0], b: p, text: rulerText(draft[0], p) });
        setDraft([]);
      } else {
        setDraft([p]);
        setRuler({ a: p, b: p, text: rulerText(p, p) });
      }
      return;
    }
    const kind = t as ShapeKind;
    const points = [...draft, p];
    if (points.length < SHAPE_POINTS[kind]) {
      setDraft(points);
      drawRef.current?.set({ draft: { kind, points } });
      return;
    }
    setDraft([]);
    drawRef.current?.set({ draft: null });
    setTool("none");
    const id = practice ? nextLocal() : await addShape({ ticker, name, view, kind, points });
    if (id !== null) setShapes((ss) => [...ss, { id, view, kind, points, color: null, alert: false }]);
  }
  function changeShape(id: number, change: Partial<Pick<Shape, "alert">>) {
    setShapes((ss) => ss.map((x) => (x.id === id ? { ...x, ...change } : x)));
    if (!practice) void updateShape(id, change);
  }
  function removeShape(id: number) {
    setShapes((ss) => ss.filter((x) => x.id !== id));
    if (!practice) void deleteShape(id);
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
      if (!practice) void updateLevel(fixed.id, { low: fixed.low, high: fixed.high, kind });
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
  }, [bars.length >= 2, big, mode]);
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
    const id = practice ? nextLocal() : await addDoodle({ ticker, view, color: PEN, points });
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
  function toggle(k: keyof typeof show) {
    const on = !show[k];
    const next = { ...show, [k]: on };
    let ord = order.filter((p) => p !== k && next[p]);
    if (on && PANES.includes(k as IndKey)) {
      ord = [...ord, k as IndKey];
      while (ord.length > MAX_PANES) next[ord.shift()!] = false;
    }
    setShow(next);
    setOrder(ord);
  }
  const panesOn = PANES.filter((p) => show[p]).length;
  const indOn = INDICATORS.filter((d) => show[d.key]);
  const pattern = show.patterns ? patternAt.get(i) : undefined;
  const div = show.divergence ? divs.find((d) => d.b === i) : undefined;

  return (
    <>
      <div className={big ? "chart-wrap big" : "chart-wrap"}>
        <div className="chart-tools" ref={toolsRef}>
          {mode === "price" && (
            <>
              <div className="segment small views">
                {VIEWS.filter((v) => !practice || ["D", "W", "M"].includes(v.key)).map((v) => <button key={v.key} type="button" aria-selected={view === v.key} onClick={() => setView(v.key)}>{v.label}</button>)}
              </div>
              <div className={intraday ? "segment small hidden" : "segment small"}>
                {RANGES.map((r) => <button key={r.key} type="button" aria-selected={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>)}
              </div>
            </>
          )}
          <div className="chart-menus">
            {mode === "price" && (
              <div className="menu">
                <button type="button" className={indOn.length ? "chip-btn on" : "chip-btn"} aria-expanded={menu === "ind"} onClick={() => setMenu(menu === "ind" ? null : "ind")}>
                  지표{indOn.length > 0 && <span className="menu-count">{indOn.length}</span>} ▾
                </button>
                {menu === "ind" && (
                  <div className="menu-pop ind-pop" role="menu">
                    {GROUPS.map(([g, title]) => (
                      <div key={g}>
                        <div className="menu-head">{title}</div>
                        {INDICATORS.filter((d) => d.group === g).map((d) => (
                          <label key={d.key} className="menu-item">
                            <input type="checkbox" checked={show[d.key]} onChange={() => toggle(d.key)} />
                            <span>{d.name}{d.note && <em>{d.note(settings)}</em>}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode === "price" && (
              <div className="menu">
                <button type="button" className="chip-btn" aria-expanded={menu === "show"} onClick={() => setMenu(menu === "show" ? null : "show")}>
                  표시{SHOWS.filter(([k]) => (k === "drawings" ? drawShown : show[k])).length > 0 && <span className="menu-count">{SHOWS.filter(([k]) => (k === "drawings" ? drawShown : show[k])).length}</span>} ▾
                </button>
                {menu === "show" && (
                  <div className="menu-pop" role="menu">
                    {SHOWS.filter(([k]) => !practice || k === "trades" || k === "drawings").map(([k, text]) => (
                      <label key={k} className="menu-item">
                        <input type="checkbox" checked={k === "drawings" ? drawShown : show[k]} onChange={() => (k === "drawings" ? setDrawShown((v) => !v) : toggle(k))} />
                        <span>{text}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!practice && <div className="segment small modes" role="tablist" aria-label="차트 종류">
              {([["price", "가격"], ["per", "PER 밴드"], ["pbr", "PBR 밴드"]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setMenu(null); setTool("none"); }}>{label}</button>
              ))}
            </div>}
            {mode === "price" && (
              <button type="button" className="chip-btn icon" aria-label={big ? "크게 보기 닫기" : "크게 보기"} title={big ? "닫기" : "크게 보기"} onClick={() => setBig((b) => !b)}>{big ? "✕" : "⛶"}</button>
            )}
          </div>
        </div>
        {mode === "price" && (near.above || near.below) && (
          <div className="chart-near">
            {near.above && <span className="near" style={{ color: RESIST, borderColor: RESIST }}>🔔 저항 {fmt(near.above.mark.low)}까지 {signed(near.above.pct)}</span>}
            {near.below && <span className="near" style={{ color: SUPPORT, borderColor: SUPPORT }}>🔔 지지 {fmt(near.below.mark.high ?? near.below.mark.low)}까지 {signed(near.below.pct)}</span>}
          </div>
        )}

        {mode === "price" && bars.length >= 2 && (
          <IndicatorChips items={indOn} settings={settings} edit={edit} setEdit={setEdit} onOff={toggle} onAdd={() => setMenu("ind")}
            onSave={(k, v) => { setSettings((s) => cleanSettings({ ...s, [k]: k === "rsi" ? v[0] : v })); setEdit(null); }} />
        )}
        {mode !== "price" ? (
          <BandChart kind={mode} candles={candles} statements={statements} shares={shares} market={market} current={current} fmt={fmt} />
        ) :         bars.length < 2 ? (
          <p className="muted chart-empty">
            {intraday
              ? "아직 분봉이 없어요. 장이 열려 있는 동안 워커가 2분마다 1분봉을 받아 오고, 최근 8일치를 보관해요."
              : "아직 가격 기록이 없습니다. 워커가 다음 수집 때(최대 12시간) 일봉을 받아 오고, 그 뒤로는 매일 종가가 쌓입니다."}
          </p>
        ) : (
          <div className="chart-box">
            <div className="chart-legend">
              <div>
                {!practice?.blind && <span className="muted">{bar.label}{view === "W" ? " 주" : view === "M" ? " 월" : ""}</span>}
                <span><i>시</i>{fmt(bar.open)}</span>
                <span><i>고</i><b className="up">{fmt(bar.high)}</b></span>
                <span><i>저</i><b className="down">{fmt(bar.low)}</b></span>
                <span><i>종</i><b>{fmt(bar.close)}</b></span>
                {prev && <span className={bar.close >= prev.close ? "up" : "down"}>{signed((bar.close / prev.close - 1) * 100)}</span>}
                {bar.volume !== null && <span><i>거래량</i>{compact(bar.volume)}</span>}
              </div>
              {show.ma && (
                <div>
                  {settings.ma.map((n, k) => maValues[k][i] !== null && (
                    <span key={n} style={{ color: MA_COLORS[k] }}>{n}{intraday ? "봉" : "일"} {fmt(maValues[k][i]!)}</span>
                  ))}
                </div>
              )}
              {panesOn > 0 && (
                <div>
                  {show.rsi && rsiValues[i] !== null && <span style={{ color: GOLD }}>RSI {rsiValues[i]!.toFixed(1)}</span>}
                  {show.macd && macdValues[i] && <span><i>MACD</i><b style={{ color: GOLD }}>{macdValues[i]!.macd.toFixed(2)}</b> <i>신호</i><b style={{ color: SIGNAL }}>{macdValues[i]!.signal.toFixed(2)}</b></span>}
                  {show.stoch && stochValues[i] && <span><i>스토캐스틱</i><b style={{ color: GOLD }}>{stochValues[i]!.k.toFixed(0)}</b> / <b style={{ color: SIGNAL }}>{stochValues[i]!.d.toFixed(0)}</b></span>}
                  {show.obv && <span><i>OBV</i>{compact(obvValues[i])}</span>}
                </div>
              )}
              {pattern && <div className="tip-memo"><b>{PATTERNS[pattern].name}</b> · {PATTERNS[pattern].text}</div>}
              {div && (
                <div className="tip-memo">
                  <b>{div.kind === "bear" ? "하락 다이버전스" : "상승 다이버전스"}</b> · {div.kind === "bear"
                    ? "가격 고점은 높아졌는데 RSI 고점은 낮아졌어요. 오르는 힘이 약해졌다는 신호예요."
                    : "가격 저점은 낮아졌는데 RSI 저점은 높아졌어요. 빠지는 힘이 약해졌다는 신호예요."}
                </div>
              )}
              {show.bb && bands[i] && (
                <div>
                  <span style={{ color: BAND }}>볼린저({settings.bb.join(", ")}) 위 {fmt(bands[i]!.upper)} · 가운데 {fmt(bands[i]!.mid)} · 아래 {fmt(bands[i]!.lower)}</span>
                </div>
              )}
              {barMemos.map((m) => <div key={m.id} className="tip-memo">{md(m.day)} {m.body}</div>)}
            </div>
            <div className="chart-stage">
              <div className="draw-rail" role="toolbar" aria-label="그리기 도구">
                <div className="rail-group">
                  <button type="button" className={isLine(tool) ? "on more" : "more"} aria-pressed={isLine(tool)} aria-expanded={lineOpen} aria-label={`선: ${LINE_TOOLS.find((t) => t.key === lineTool)!.name}`}
                    title="선 (가로선·추세선·평행 채널)" onClick={() => setLineOpen((v) => !v)}>{LINE_TOOLS.find((t) => t.key === lineTool)!.icon}</button>
                  {lineOpen && (
                    <div className="rail-fly" role="menu">
                      {LINE_TOOLS.map((t) => (
                        <button key={t.key} type="button" role="menuitem" className={tool === t.key ? "on" : ""}
                          onClick={() => { setLineTool(t.key); setTool(t.key); setLineOpen(false); setDrawShown(true); }}>
                          <span>{t.icon}</span>{t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {TOOLS.filter((t) => !isLine(t.key)).map((t) => (
                  <button key={t.key} type="button" className={tool === t.key ? "on" : ""} aria-pressed={tool === t.key} aria-label={t.name} title={t.name}
                    onClick={() => { setTool(tool === t.key ? "none" : t.key); setDrawShown(true); setLineOpen(false); }}><span className={t.icon === "Fib" ? "fib-ic" : ""}>{t.icon}</span></button>
                ))}
                <i />
                <button type="button" className={magnet ? "on" : ""} aria-pressed={magnet} aria-label="자석" title="자석: 캔들 꼬리·몸통에 붙이기" onClick={() => setMagnet((v) => !v)}>🧲</button>
                <button type="button" className={drawShown ? "" : "on"} aria-pressed={!drawShown} aria-label={drawShown ? "그림 숨기기" : "그림 보이기"} title={drawShown ? "그림 숨기기" : "그림 보이기"}
                  onClick={() => setDrawShown((v) => !v)}>{drawShown ? "👁" : "🚫"}</button>
              </div>
              <div className="chart-area">
              <div ref={box} className={panesOn === 0 ? "chart-canvas" : panesOn === 1 ? "chart-canvas tall" : "chart-canvas taller"} />
              {tool === "pen" && (
                <div className="pen-layer" onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp} />
              )}
              {(tool === "line" || tool === "zone" || tool === "eraser") && <div className="pen-layer" onPointerUp={tap} />}
              {(tool === "trend" || tool === "channel" || tool === "fib" || tool === "ruler") && <div className="pen-layer" onPointerUp={tapShape} onPointerMove={hoverShape} />}
              {tool !== "none" && (
                <div className="draw-hint">
                  {tool === "zone" && pending !== null ? `${fmt(pending)}을 골랐어요. 이제 구간의 다른 끝을 누르세요.`
                    : (tool === "trend" || tool === "channel" || tool === "fib") && draft.length
                      ? `${draft.length}번째 점을 찍었어요. ${tool === "channel" && draft.length === 2 ? "이제 평행선이 지나갈 자리를 누르세요." : "다음 점을 누르세요."}`
                      : TOOLS.find((t) => t.key === tool)!.hint}
                </div>
              )}
              </div>
            </div>
          </div>
        )}
        {mode === "price" && !practice && <p className="chart-foot">
          휠이나 두 손가락으로 확대하고, 끌어서 옮겨요. 차트를 누르면 그 날짜는 메모 칸에, 그 높이의 가격은 알림 칸에 들어가요. 지지·저항은 모든 차트에, 낙서는 그린 차트에만 보여요. 선·구간은 ↕ 옮기기를 켜고 잡아 끌면 옮겨지고, 🧲 자석이 켜져 있으면 캔들 꼬리·몸통에 붙어요. 차트:{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts
        </p>}
      </div>

      {viewShapes.length > 0 && (
        <div className="list levels-list">
          <div className="muted levels-head">{practice ? "이 연습에서 그린 추세선·채널·피보나치 · 저장되지 않아요" : "이 차트에 그린 추세선·채널·피보나치 · 일봉 추세선·채널은 🔔를 켜 두면 가격이 닿을 때 텔레그램으로 알려요"}</div>
          {viewShapes.map((x) => (
            <div key={x.id} className="list-item level-row">
              <span className="sw line" style={{ background: x.color ?? "#e7cf9c" }} />
              <b className="level-kind">{SHAPE_LABEL[x.kind]}</b>
              <span className="num">
                {x.kind === "fib"
                  ? `${fmt(x.points[0][2])} → ${fmt(x.points[1][2])} · 50% ${fmt(fibPrices(x.points[0][2], x.points[1][2])[3].price)}`
                  : practice?.blind ? `${fmt(x.points[0][2])} → ${fmt(x.points[1][2])}`
                    : `${x.points[0][0].slice(0, 10)} ${fmt(x.points[0][2])} → ${x.points[1][0].slice(0, 10)} ${fmt(x.points[1][2])}`}
              </span>
              {x.kind !== "fib" && view === "D" && !practice && (
                <button type="button" className={x.alert ? "chip-btn on" : "chip-btn"} aria-pressed={x.alert} onClick={() => changeShape(x.id, { alert: !x.alert })}>
                  {x.alert ? "🔔 알림 켜짐" : "🔕 알림 꺼짐"}
                </button>
              )}
              <button type="button" className="ghost" onClick={() => removeShape(x.id)}>지우기</button>
            </div>
          ))}
        </div>
      )}

      {marks.length > 0 && (
        <div className="list levels-list">
          <div className="muted levels-head">{practice ? "이 연습에서 그린 지지·저항 · 저장되지 않아요" : "내가 그린 지지·저항 · 🔔를 켜 두면 가격이 닿을 때 텔레그램으로 알려요"}</div>
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
              {!practice && (
                <button type="button" className={m.alert ? "chip-btn on" : "chip-btn"} aria-pressed={m.alert} onClick={() => changeMark(m.id, { alert: !m.alert })}>
                  {m.alert ? "🔔 알림 켜짐" : "🔕 알림 꺼짐"}
                </button>
              )}
              <button type="button" className="ghost" onClick={() => removeMark(m.id)}>지우기</button>
            </div>
          ))}
        </div>
      )}

      {!practice && <form action={addAlert} className="memo-form alert-form" onSubmit={() => setTimeout(() => setPick(""), 0)}>
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
      </form>}

      {!practice && <form action={addChartMemo} className="row memo-form">
        <input type="hidden" name="ticker" value={ticker} />
        <input type="date" name="day" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
        <input name="body" placeholder="이 날 무슨 생각을 했나요? (예: 실적 발표 후 급락, 분할매수 시작)" maxLength={500} required />
        <button type="submit">메모 남기기</button>
      </form>}

      {!practice && memos.length > 0 && (
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

// 지우개: 누른 자리와 그림 사이 거리(화면 픽셀). 추세선·채널은 오른쪽으로 늘린 부분까지, 피보나치는 가로선들까지.
function shapeDistance(d: Drawings, s: Shape, p: [number, number]): number {
  const px = d.shapePixels(s.points);
  if (!px) return Infinity;
  if (s.kind === "fib") {
    const left = Math.min(px[0][0], px[1][0]);
    if (p[0] < left) return Infinity;
    return Math.min(...fibPrices(s.points[0][2], s.points[1][2]).map((l) => Math.abs((d.y(l.price) ?? -1e9) - p[1])));
  }
  const [a, b] = px;
  const far: [number, number] = b[0] === a[0] ? b : [a[0] + (b[0] - a[0]) * 1e3, a[1] + (b[1] - a[1]) * 1e3];
  let best = segmentDistance(p, a, far);
  if (s.kind === "channel" && px[2]) {
    const off = px[2][1] - (a[1] + (b[0] === a[0] ? 0 : ((b[1] - a[1]) * (px[2][0] - a[0])) / (b[0] - a[0])));
    best = Math.min(best, segmentDistance(p, [a[0], a[1] + off], [far[0], far[1] + off]));
  }
  return best;
}

// 고른 기간이 시작하는 봉 번호. 전체면 0.
function rangeStart(bars: Bar[], range: Range): number {
  const months = RANGES.find((r) => r.key === range)!.months;
  if (!months || bars.length < 2) return 0;
  const from = new Date(`${bars[bars.length - 1].day}T00:00:00Z`);
  from.setUTCMonth(from.getUTCMonth() - months);
  return Math.max(0, bars.findIndex((b) => b.day >= from.toISOString().slice(0, 10)));
}

// 켜 둔 지표 이름표. ⚙로 숫자를 바꾸고 ✕로 꺼요.
function IndicatorChips({ items, settings, edit, setEdit, onOff, onAdd, onSave }: {
  items: typeof INDICATORS; settings: Settings; edit: EditKey | null; setEdit: (k: EditKey | null) => void;
  onOff: (k: IndKey) => void; onAdd: () => void; onSave: (k: EditKey, v: number[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => {
    if (edit) setDraft(FIELDS[edit].map((_, k) => String(([] as number[]).concat(settings[edit])[k] ?? "")));
  }, [edit, settings]);
  useEffect(() => {
    if (!edit) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setEdit(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [edit, setEdit]);
  const target = items.find((d) => d.edit === edit);
  return (
    <div className="ind-chips" ref={ref}>
      {items.map((d) => (
        <span key={d.key} className={d.edit && edit === d.edit ? "ind-chip on" : "ind-chip"}>
          {d.edit ? (
            <button type="button" title="숫자 바꾸기" onClick={() => setEdit(edit === d.edit ? null : d.edit!)}>
              {d.name}{d.note && <em>{d.note(settings)}</em>} ⚙
            </button>
          ) : <span>{d.name}{d.note && <em>{d.note(settings)}</em>}</span>}
          <button type="button" className="x" aria-label={`${d.name} 끄기`} title="끄기" onClick={() => onOff(d.key)}>✕</button>
        </span>
      ))}
      <button type="button" className="ind-chip add" onClick={onAdd}>＋ 지표</button>
      {edit && target && (
        <div className="ind-edit" role="dialog" aria-label={`${target.name} 숫자 바꾸기`}>
          <b>{target.name} {edit === "ma" ? "기간 (비우면 빠져요)" : "숫자"}</b>
          <div className="ind-fields">
            {FIELDS[edit].map((label, k) => (
              <label key={k}>
                <span>{edit === "ma" ? <i style={{ background: MA_COLORS[k] }} /> : label}</span>
                <input inputMode="decimal" value={draft[k] ?? ""} onChange={(e) => setDraft((d) => d.map((x, j) => (j === k ? e.target.value : x)))} />
              </label>
            ))}
          </div>
          <div className="ind-btns">
            <button type="button" className="ghost" onClick={() => onSave(edit, ([] as number[]).concat(DEFAULTS[edit]))}>기본값으로</button>
            <button type="button" onClick={() => onSave(edit, draft.filter((x) => x.trim() !== "").map(Number))}>저장</button>
          </div>
        </div>
      )}
    </div>
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
