"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import type { Candle } from "@/lib/candles";

// 실험실 거래 하나: 일봉 위에 산 곳(B)·판 곳(S), 손절·익절선.
const UP = "#e8806f", DOWN = "#86a8e6", MUTED = "#9b968b", LINE = "#1b1b1f", GOLD = "#c9a96b";

export default function LabTradeChart({ bars, market, buy, sell, stop, target }: {
  bars: Candle[]; market: string; buy: { day: string; price: number }; sell: { day: string; price: number }; stop: number | null; target: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current || bars.length < 2) return;
    let gone = false;
    let chart: IChartApi | null = null;
    const el = box.current;
    (async () => {
      const lc = await import("lightweight-charts");
      if (gone) return;
      chart = lc.createChart(el, {
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: "transparent" }, textColor: MUTED, fontSize: 11, fontFamily: "'Pretendard Variable', Pretendard, sans-serif", attributionLogo: false },
        grid: { vertLines: { color: LINE }, horzLines: { color: LINE } },
        rightPriceScale: { borderColor: "#26262b", scaleMargins: { top: 0.1, bottom: 0.08 } },
        timeScale: { borderColor: "#26262b", rightOffset: 2 },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
      });
      const fmt = (v: number) => (market === "US" ? `$${v.toFixed(2)}` : Math.round(v).toLocaleString("ko-KR"));
      const s = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
        priceFormat: { type: "custom", formatter: fmt, minMove: market === "US" ? 0.01 : 1 },
        autoscaleInfoProvider: (base: () => import("lightweight-charts").AutoscaleInfo | null) => {
          const r = base();
          if (!r?.priceRange) return r;
          const marks = [buy.price, sell.price, stop, target].filter((v): v is number => v !== null && v > 0);
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...marks), maxValue: Math.max(r.priceRange.maxValue, ...marks) } };
        },
      });
      s.setData(bars.map((b) => ({ time: b.day as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
      s.createPriceLine({ price: buy.price, color: GOLD, lineWidth: 1, lineStyle: lc.LineStyle.Solid, axisLabelVisible: true, title: "산 값" });
      if (target) s.createPriceLine({ price: target, color: UP, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "익절" });
      if (stop) s.createPriceLine({ price: stop, color: DOWN, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "손절" });
      const at = (day: string) => bars.find((b) => b.day >= day)?.day;
      const b = at(buy.day), x = at(sell.day);
      const marks = [];
      if (b) marks.push({ time: b as Time, position: "belowBar" as const, color: UP, shape: "arrowUp" as const, text: "B" });
      if (x) marks.push({ time: x as Time, position: "aboveBar" as const, color: DOWN, shape: "arrowDown" as const, text: "S" });
      lc.createSeriesMarkers(s, marks);
      chart.timeScale().fitContent();
    })();
    return () => { gone = true; chart?.remove(); };
  }, [bars, market, buy.day, buy.price, sell.day, sell.price, stop, target]);
  return <div className="lab-chart" ref={box} role="img" aria-label={`${buy.day} 산 곳과 ${sell.day} 판 곳 차트`} />;
}
