"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, LogicalRange, MouseEventParams, Time } from "lightweight-charts";
import { aggregate, sma, type Candle, type Period } from "@/lib/candles";
import { cleanSettings, DEFAULTS, type Settings } from "@/lib/indicators";

export type Cell = { ticker: string; name: string; market: "KR" | "US"; candles: Candle[] };
type Layout = 1 | 2 | 4;
type Mounted = { chart: IChartApi; price: ISeriesApi<"Candlestick">; close: Map<string, number> };

const SAVE_KEY = "chart-grid-v1"; // 이 기기에 마지막 배치(종목·칸 수·같이 움직이기)를 기억해요
const UP = "#e8806f", DOWN = "#86a8e6", GOLD = "#c9a96b", MUTED = "#9b968b", LINE = "#1b1b1f";
const MA_COLORS = [GOLD, "#b48ead", "#7fb8a4", "#8a857b"];
const PERIODS: { key: Period; label: string }[] = [{ key: "D", label: "일" }, { key: "W", label: "주" }, { key: "M", label: "월" }];
const SHOWN: Record<Period, number> = { D: 130, W: 104, M: 60 }; // 처음 보이는 봉 수

export default function ChartGrid({ cells, layout, options, fromUrl }: { cells: Cell[]; layout: Layout; options: { ticker: string; name: string }[]; fromUrl: boolean }) {
  const router = useRouter();
  const [periods, setPeriods] = useState<Period[]>(() => cells.map(() => "D"));
  const [syncCross, setSyncCross] = useState(true);
  const [syncRange, setSyncRange] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [maOn, setMaOn] = useState(true);
  const mounted = useRef(new Map<number, Mounted>());
  const busy = useRef(false); // 다른 칸을 따라 움직이는 중이면 되돌려 보내지 않아요
  const syncRef = useRef({ cross: syncCross, range: syncRange });
  syncRef.current = { cross: syncCross, range: syncRange };

  // 주소에 종목이 없으면 지난번 배치로, 있으면 그걸 기억해요.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
      if (saved) {
        if (typeof saved.cross === "boolean") setSyncCross(saved.cross);
        if (typeof saved.range === "boolean") setSyncRange(saved.range);
        if (Array.isArray(saved.periods)) setPeriods(cells.map((_, i) => (["D", "W", "M"].includes(saved.periods[i]) ? saved.periods[i] : "D")));
        if (!fromUrl && typeof saved.t === "string" && saved.t) router.replace(`/chart?t=${encodeURIComponent(saved.t)}&n=${saved.n ?? 4}`);
      }
      const ind = JSON.parse(localStorage.getItem("chart-indicators-v1") ?? "null");
      if (ind) {
        setSettings(cleanSettings(ind.settings));
        if (typeof ind.show?.ma === "boolean") setMaOn(ind.show.ma);
      }
    } catch { /* 저장 공간을 못 쓰면 기본값으로 */ }
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tickers = cells.map((c) => c.ticker).join(",");
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ t: tickers, n: layout, cross: syncCross, range: syncRange, periods }));
    } catch { /* 무시 */ }
  }, [tickers, layout, syncCross, syncRange, periods]);

  function go(next: string[], n: Layout = layout) {
    router.push(`/chart?t=${encodeURIComponent(next.filter(Boolean).join(","))}&n=${n}`);
  }
  function setTicker(i: number, ticker: string) {
    const next = Array.from({ length: Math.max(layout, cells.length) }, (_, k) => cells[k]?.ticker ?? "");
    next[i] = ticker.trim().toUpperCase();
    go(next);
  }
  function setPeriod(i: number, p: Period) {
    setPeriods((ps) => (syncRange ? ps.map(() => p) : ps.map((x, k) => (k === i ? p : x))));
  }
  // 한 칸의 십자선·보이는 구간을 다른 칸에 따라 그려요. 날짜(봉 키)로 맞춰서 종목마다 쉬는 날이 달라도 돼요.
  function follow(from: number, kind: "cross" | "range", time: Time | null, range: LogicalRange | null) {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const [i, m] of mounted.current) {
        if (i === from) continue;
        if (kind === "cross") {
          const v = time === null ? undefined : m.close.get(String(time));
          if (v === undefined) m.chart.clearCrosshairPosition();
          else m.chart.setCrosshairPosition(v, time!, m.price);
        } else if (range) {
          // 오른쪽 끝에서 몇 봉 떨어졌는지로 맞춰요(종목마다 봉 개수가 달라서).
          const src = mounted.current.get(from)!;
          const shift = m.close.size - src.close.size;
          m.chart.timeScale().setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
        }
      }
    } finally {
      busy.current = false;
    }
  }

  const slots = Array.from({ length: layout }, (_, i) => cells[i] ?? null);
  return (
    <>
      <div className="board-head">
        <h1>차트 <span className="muted chart-grid-sub">여러 종목을 한 화면에</span></h1>
        <div className="chart-grid-tools">
          <div className="segment small" role="radiogroup" aria-label="칸 수">
            {([1, 2, 4] as const).map((n) => (
              <button key={n} type="button" className={n === 4 ? "pc-only" : ""} aria-selected={layout === n} onClick={() => go(cells.map((c) => c.ticker), n)}>{n}칸</button>
            ))}
          </div>
          <button type="button" className={syncCross ? "chip-btn on" : "chip-btn"} aria-pressed={syncCross} onClick={() => setSyncCross((v) => !v)}>🔗 십자선 같이</button>
          <button type="button" className={syncRange ? "chip-btn on" : "chip-btn"} aria-pressed={syncRange} onClick={() => setSyncRange((v) => !v)}>🔗 기간 같이</button>
        </div>
      </div>
      <datalist id="chart-grid-names">{options.map((o) => <option key={o.ticker} value={o.ticker}>{o.name}</option>)}</datalist>
      <div className={`chart-grid n${layout}`}>
        {slots.map((c, i) => (
          <div key={`${i}-${c?.ticker ?? ""}`} className="chart-cell panel">
            <div className="chart-cell-head">
              {c ? (
                <>
                  <Link href={`/stock/${encodeURIComponent(c.ticker)}`} className="stock-link"><b>{c.name}</b></Link>
                  <span className="muted">{c.ticker}</span>
                  <Change candles={c.candles} />
                </>
              ) : <span className="muted">종목을 고르세요</span>}
              <span className="chart-cell-right">
                {c && (
                  <div className="segment small" role="radiogroup" aria-label="봉 단위">
                    {PERIODS.map((p) => <button key={p.key} type="button" aria-selected={periods[i] === p.key} onClick={() => setPeriod(i, p.key)}>{p.label}</button>)}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("t"); if (v) setTicker(i, String(v)); }}>
                  <input name="t" list="chart-grid-names" placeholder={c ? "종목 바꾸기" : "종목코드·티커"} aria-label="종목 바꾸기" />
                </form>
              </span>
            </div>
            {c && (c.candles.length < 2
              ? <p className="muted chart-empty">아직 이 종목 일봉이 없어요. 관심종목에 넣으면 워커가 받아 와요.</p>
              : <Mini cell={c} period={periods[i] ?? "D"} settings={maOn ? settings : null} layout={layout}
                  onMount={(m) => (m ? mounted.current.set(i, m) : mounted.current.delete(i))}
                  onCross={(t) => syncRef.current.cross && follow(i, "cross", t, null)}
                  onRange={(r) => syncRef.current.range && follow(i, "range", null, r)} />)}
          </div>
        ))}
      </div>
      <p className="chart-foot">칸마다 종목을 바꿀 수 있어요. 🔗 기간 같이를 켜면 한 칸을 끌거나 확대할 때 다른 칸도 같이 움직이고, 일·주·월도 같이 바뀌어요. 그리기·지표는 종목 이름을 눌러 종목 화면에서 쓰세요.</p>
    </>
  );
}

function Change({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return null;
  const [a, b] = candles.slice(-2);
  const pct = (b.close / a.close - 1) * 100;
  return <span className={pct > 0 ? "up" : pct < 0 ? "down" : ""}>{pct > 0 ? "+" : ""}{pct.toFixed(2)}%</span>;
}

function Mini({ cell, period, settings, layout, onMount, onCross, onRange }: {
  cell: Cell; period: Period; settings: Settings | null; layout: Layout;
  onMount: (m: Mounted | null) => void; onCross: (t: Time | null) => void; onRange: (r: LogicalRange | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const bars = useMemo(() => aggregate(cell.candles, period), [cell.candles, period]);
  const cb = useRef({ onMount, onCross, onRange });
  cb.current = { onMount, onCross, onRange };
  const fmt = (v: number) => (cell.market === "US" ? `$${v.toFixed(2)}` : Math.round(v).toLocaleString("ko-KR"));
  useEffect(() => {
    if (!box.current) return;
    let disposed = false;
    let chart: IChartApi | null = null;
    const el = box.current;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed) return;
      chart = lc.createChart(el, {
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: "transparent" }, textColor: MUTED, fontSize: 11, fontFamily: "'Pretendard Variable', Pretendard, sans-serif", attributionLogo: false },
        grid: { vertLines: { color: LINE }, horzLines: { color: LINE } },
        crosshair: { mode: lc.CrosshairMode.Normal, vertLine: { color: MUTED, labelBackgroundColor: "#2a2418" }, horzLine: { color: MUTED, labelBackgroundColor: "#2a2418" } },
        rightPriceScale: { borderColor: "#26262b", scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: { borderColor: "#26262b", rightOffset: 3, minBarSpacing: 1.5 },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
        // 폰에서 위아래로 쓸면 차트가 아니라 화면이 내려가요. 옆으로 끌기는 그대로.
        handleScroll: { vertTouchDrag: false },
      });
      const price = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineColor: GOLD,
        priceFormat: { type: "custom", formatter: fmt, minMove: cell.market === "US" ? 0.01 : 1 },
      });
      price.setData(bars.map((b) => ({ time: b.day as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
      const closes = bars.map((b) => b.close);
      settings?.ma.forEach((n, k) => {
        const v = sma(closes, n);
        const s = chart!.addSeries(lc.LineSeries, { color: MA_COLORS[k], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(bars.flatMap((b, i) => (v[i] === null ? [] : [{ time: b.day as Time, value: v[i]! }])));
      });
      if (bars.some((b) => b.volume)) {
        // 거래량은 따로 칸을 만들지 않고 아래쪽에 얕게 깔아요(칸이 작아서).
        const vol = chart.addSeries(lc.HistogramSeries, { priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" } });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
        vol.setData(bars.map((b, i) => ({
          time: b.day as Time, value: b.volume ?? 0,
          color: (i === 0 ? b.close >= b.open : b.close >= bars[i - 1].close) ? "rgba(232,128,111,0.45)" : "rgba(134,168,230,0.45)",
        })));
      }
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - SHOWN[period]) - 0.5, to: bars.length - 1 + 3 });
      chart.subscribeCrosshairMove((p: MouseEventParams<Time>) => { if (p.sourceEvent) cb.current.onCross(p.time ?? null); });
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => cb.current.onRange(r));
      cb.current.onMount({ chart, price, close: new Map(bars.map((b) => [b.day, b.close])) });
    })();
    return () => {
      disposed = true;
      cb.current.onMount(null);
      chart?.remove();
    };
    // fmt는 market과 같이 바뀌어요.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, settings, layout, period]);
  return <div ref={box} className="chart-cell-canvas" />;
}
