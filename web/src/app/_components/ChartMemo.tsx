"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesMarker, Time } from "lightweight-charts";
import { addChartMemo, deleteChartMemo } from "@/app/actions";
import { aggregate, bucketOf, rsi, sma, type Candle, type Period } from "@/lib/candles";

export type { Candle };
export type Memo = { id: number; day: string; body: string };
export type Trade = { day: string; side: "buy" | "sell"; price: number; quantity: number };
export type Level = { kind: "avg" | "stop" | "target"; price: number };

const UP = "#e8806f", DOWN = "#86a8e6", GOLD = "#c9a96b", MUTED = "#9b968b", LINE = "#1b1b1f";
const MAS = [
  { n: 5, color: GOLD },
  { n: 20, color: "#b48ead" },
  { n: 60, color: "#7fb8a4" },
  { n: 120, color: "#8a857b" },
];
const PERIODS: { key: Period; label: string }[] = [{ key: "D", label: "일" }, { key: "W", label: "주" }, { key: "M", label: "월" }];
const RANGES = [
  { key: "3m", label: "3개월", months: 3 },
  { key: "6m", label: "6개월", months: 6 },
  { key: "1y", label: "1년", months: 12 },
  { key: "all", label: "전체", months: 0 },
] as const;
type Range = (typeof RANGES)[number]["key"];
const LEVEL = { avg: { label: "평단", color: GOLD }, stop: { label: "손절", color: DOWN }, target: { label: "목표", color: UP } };

const md = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const compact = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${(v / 1e4).toFixed(0)}만` : v.toLocaleString("ko-KR"));

export default function ChartMemo({ ticker, market, candles, memos, trades, levels, today }: {
  ticker: string; market: string; candles: Candle[]; memos: Memo[]; trades: Trade[]; levels: Level[]; today: string;
}) {
  const [period, setPeriod] = useState<Period>("D");
  const [range, setRange] = useState<Range>("6m");
  const [show, setShow] = useState({ ma: true, volume: true, rsi: false, trades: true, memos: true, levels: true });
  const [big, setBig] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef<Range>(range);
  rangeRef.current = range;

  const fmt = (v: number) => (market === "US" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.round(v).toLocaleString("ko-KR"));
  const bars = useMemo(() => aggregate(candles, period), [candles, period]);
  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const maValues = useMemo(() => MAS.map((m) => sma(closes, m.n)), [closes]);
  const memosByBar = useMemo(() => {
    const map = new Map<string, Memo[]>();
    for (const m of memos) {
      const key = bucketOf(m.day, period);
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  }, [memos, period]);

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
        timeScale: { borderColor: "#26262b", rightOffset: 4, minBarSpacing: 2 },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
      });
      chartRef.current = chart;

      const price = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
        priceLineColor: GOLD,
        priceFormat: { type: "custom", formatter: fmt, minMove: market === "US" ? 0.01 : 1 },
      });
      price.setData(bars.map((b) => ({ time: b.day as Time, open: b.open, high: b.high, low: b.low, close: b.close })));

      if (show.ma) {
        MAS.forEach((m, k) => {
          const s = chart!.addSeries(lc.LineSeries, { color: m.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData(bars.flatMap((b, i) => (maValues[k][i] === null ? [] : [{ time: b.day as Time, value: maValues[k][i]! }])));
        });
      }

      let pane = 1;
      if (show.volume && bars.some((b) => b.volume)) {
        const vol = chart.addSeries(lc.HistogramSeries, { priceFormat: { type: "custom", formatter: compact }, priceLineVisible: false, lastValueVisible: false }, pane);
        vol.setData(bars.map((b, i) => ({
          time: b.day as Time, value: b.volume ?? 0,
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
        s.setData(bars.flatMap((b, i) => (r[i] === null ? [] : [{ time: b.day as Time, value: r[i]! }])));
        for (const v of [30, 70]) s.createPriceLine({ price: v, color: v === 30 ? DOWN : UP, lineWidth: 1, lineStyle: lc.LineStyle.Dotted, axisLabelVisible: false, title: "" });
        chart.panes()[pane].setStretchFactor(0.28);
      }

      if (show.levels) {
        for (const l of levels) {
          price.createPriceLine({ price: l.price, color: LEVEL[l.kind].color, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: LEVEL[l.kind].label });
        }
      }

      const markers: SeriesMarker<Time>[] = [];
      const first = bars[0].day;
      if (show.trades) {
        for (const t of trades) {
          if (t.day < first) continue;
          markers.push(t.side === "buy"
            ? { time: bucketOf(t.day, period) as Time, position: "belowBar", shape: "arrowUp", color: UP, text: "매수" }
            : { time: bucketOf(t.day, period) as Time, position: "aboveBar", shape: "arrowDown", color: DOWN, text: "매도" });
        }
      }
      if (show.memos) {
        for (const key of memosByBar.keys()) {
          if (key >= first) markers.push({ time: key as Time, position: "aboveBar", shape: "circle", color: "#ece8df", size: 0.8 });
        }
      }
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      lc.createSeriesMarkers(price, markers);

      const index = new Map(bars.map((b, i) => [b.day, i]));
      chart.subscribeCrosshairMove((p: MouseEventParams<Time>) => setHover(p.time ? index.get(String(p.time)) ?? null : null));
      chart.subscribeClick((p: MouseEventParams<Time>) => {
        if (p.time) setDay(String(p.time) > today ? today : String(p.time));
      });
      applyRange(chart, bars, rangeRef.current);
    })();
    return () => {
      disposed = true;
      chart?.remove();
      chartRef.current = null;
    };
    // fmt·period는 bars·market과 함께 바뀌므로 의존성에서 뺍니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, show, levels, trades, memosByBar, maValues, closes, today, big]);

  useEffect(() => {
    if (chartRef.current) applyRange(chartRef.current, bars, range);
  }, [range, bars]);

  useEffect(() => {
    if (!big) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [big]);

  const i = hover ?? bars.length - 1;
  const bar = bars[i];
  const prev = i > 0 ? bars[i - 1] : null;
  const barMemos = bar ? memosByBar.get(bar.day) ?? [] : [];
  const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <>
      <div className={big ? "chart-wrap big" : "chart-wrap"}>
        <div className="chart-tools">
          <div className="segment small">
            {PERIODS.map((p) => <button key={p.key} type="button" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
          </div>
          <div className="segment small">
            {RANGES.map((r) => <button key={r.key} type="button" aria-selected={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>)}
          </div>
          <div className="chart-toggles">
            {([["ma", "이동평균"], ["volume", "거래량"], ["rsi", "RSI"], ["trades", "매매"], ["levels", "평단·손절·목표"], ["memos", "메모"]] as const).map(([k, label]) => (
              <button key={k} type="button" className={show[k] ? "chip-btn on" : "chip-btn"} aria-pressed={show[k]} onClick={() => toggle(k)}>{label}</button>
            ))}
            <button type="button" className="chip-btn" onClick={() => setBig((b) => !b)}>{big ? "닫기 ✕" : "크게 보기"}</button>
          </div>
        </div>

        {bars.length < 2 ? (
          <p className="muted">아직 가격 기록이 없습니다. 워커가 다음 수집 때(최대 12시간) 일봉을 받아 오고, 그 뒤로는 매일 종가가 쌓입니다.</p>
        ) : (
          <div className="chart-box">
            <div className="chart-legend">
              <div>
                <span className="muted">{bar.day}{period === "W" ? " 주" : period === "M" ? " 월" : ""}</span>
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
                    <span key={m.n} style={{ color: m.color }}>{m.n}일 {fmt(maValues[k][i]!)}</span>
                  ))}
                </div>
              )}
              {barMemos.map((m) => <div key={m.id} className="tip-memo">{md(m.day)} {m.body}</div>)}
            </div>
            <div ref={box} className={show.rsi ? "chart-canvas tall" : "chart-canvas"} />
          </div>
        )}
        <p className="chart-foot">
          휠이나 두 손가락으로 확대하고, 끌어서 옮겨요. 날짜를 누르면 아래 메모 날짜가 바뀌어요. 차트:{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts
        </p>
      </div>

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

function applyRange(chart: IChartApi, bars: Candle[], range: Range) {
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
