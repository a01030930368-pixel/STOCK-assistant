"use client";

import { useEffect, useRef, useState } from "react";
import { saveChart } from "@/app/actions";

export type ShotBar = { day: string; open: number; high: number; low: number; close: number };
export type ShotLine = { price: number; kind: "up" | "down" | "muted"; title: string };
type Props = {
  side: "buy" | "sell"; entryId: number; bars: ShotBar[]; day: string; price: number; lines: ShotLine[]; saved: string | null;
};

const UP = "#e8806f", DOWN = "#86a8e6", GOLD = "#c9a96b", MUTED = "#9b968b", LINE = "#1b1b1f", SURFACE = "#131316";
const COLOR = { up: UP, down: DOWN, muted: MUTED };

// 매수·매도일까지의 일봉을 한 번 그려서 그림(PNG)으로 저장합니다. 그 뒤로는 저장한 그림만 보여 줘요(가격이 나중에 수정돼도 그날 모습 그대로).
// 매수는 손절·익절 선, 매도는 평단 선을 함께 그려요.
export default function ChartShot({ side, entryId, bars, day, price, lines, saved }: Props) {
  const label = side === "buy" ? "매수" : "매도";
  const box = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState(saved);

  useEffect(() => {
    if (image || bars.length < 5 || !box.current) return;
    let chart: import("lightweight-charts").IChartApi | null = null;
    let gone = false;
    (async () => {
      const lc = await import("lightweight-charts");
      if (gone || !box.current) return;
      chart = lc.createChart(box.current, {
        width: box.current.clientWidth || 640, height: 280,
        layout: {
          background: { type: lc.ColorType.Solid, color: SURFACE }, textColor: MUTED, fontSize: 11,
          fontFamily: "'Pretendard Variable', Pretendard, sans-serif", attributionLogo: false,
        },
        grid: { vertLines: { color: LINE }, horzLines: { color: LINE } },
        rightPriceScale: { borderColor: "#26262b", scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderColor: "#26262b", rightOffset: 3 },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
        handleScroll: false, handleScale: false,
      });
      const s = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineVisible: false,
        // 매수·매도가와 함께 그리는 선이 차트 밖으로 나가지 않게 세로 범위에 넣습니다.
        autoscaleInfoProvider: (base: () => import("lightweight-charts").AutoscaleInfo | null) => {
          const r = base();
          if (!r?.priceRange) return r;
          const marks = [price, ...lines.map((l) => l.price)].filter((v) => v > 0);
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...marks), maxValue: Math.max(r.priceRange.maxValue, ...marks) } };
        },
      });
      s.setData(bars.map((b) => ({ time: b.day, open: b.open, high: b.high, low: b.low, close: b.close })));
      s.createPriceLine({ price, color: GOLD, lineWidth: 2, lineStyle: lc.LineStyle.Solid, axisLabelVisible: true, title: label });
      for (const l of lines) {
        if (l.price > 0) s.createPriceLine({ price: l.price, color: COLOR[l.kind], lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: l.title });
      }
      const at = [...bars].reverse().find((b) => b.day <= day)?.day;
      if (at) {
        lc.createSeriesMarkers(s, [side === "buy"
          ? { time: at, position: "belowBar", color: GOLD, shape: "arrowUp", text: label }
          : { time: at, position: "aboveBar", color: GOLD, shape: "arrowDown", text: label }]);
      }
      chart.timeScale().fitContent();
      // 그려질 시간을 조금 준 뒤 찍습니다.
      await new Promise((r) => setTimeout(r, 400));
      if (gone || !chart) return;
      const url = chart.takeScreenshot().toDataURL("image/png");
      await saveChart(side, entryId, url).catch(() => undefined);
      if (!gone) setImage(url);
    })();
    return () => { gone = true; chart?.remove(); };
  }, [image, bars, day, price, lines, side, label, entryId]);

  if (image) return <img className="buy-shot" src={image} alt={`${day} ${label} 당시 차트`} />;
  if (bars.length < 5) return <p className="muted">{label}일까지의 일봉이 아직 없어요. 워커가 받아 오면 다음에 열 때 그림으로 남겨요.</p>;
  return <div ref={box} className="buy-shot-live" />;
}
