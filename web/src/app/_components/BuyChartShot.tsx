"use client";

import { useEffect, useRef, useState } from "react";
import { saveBuyChart } from "@/app/actions";

export type ShotBar = { day: string; open: number; high: number; low: number; close: number };
type Props = {
  entryId: number; bars: ShotBar[]; buyDay: string; buyPrice: number; stop: number; target: number; saved: string | null;
};

const UP = "#e8806f", DOWN = "#86a8e6", GOLD = "#c9a96b", MUTED = "#9b968b", LINE = "#1b1b1f", SURFACE = "#131316";

// 매수일까지의 일봉을 한 번 그려서 그림(PNG)으로 저장합니다. 그 뒤로는 저장한 그림만 보여 줘요(가격이 나중에 수정돼도 그날 모습 그대로).
export default function BuyChartShot({ entryId, bars, buyDay, buyPrice, stop, target, saved }: Props) {
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
        // 매수가·손절·익절 선이 차트 밖으로 나가지 않게 세로 범위에 넣습니다.
        autoscaleInfoProvider: (base: () => import("lightweight-charts").AutoscaleInfo | null) => {
          const r = base();
          if (!r?.priceRange) return r;
          const marks = [buyPrice, stop, target].filter((v) => v > 0);
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...marks), maxValue: Math.max(r.priceRange.maxValue, ...marks) } };
        },
      });
      s.setData(bars.map((b) => ({ time: b.day, open: b.open, high: b.high, low: b.low, close: b.close })));
      s.createPriceLine({ price: buyPrice, color: GOLD, lineWidth: 2, lineStyle: lc.LineStyle.Solid, axisLabelVisible: true, title: "매수" });
      if (stop > 0) s.createPriceLine({ price: stop, color: DOWN, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "손절" });
      if (target > 0) s.createPriceLine({ price: target, color: UP, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "익절" });
      const at = [...bars].reverse().find((b) => b.day <= buyDay)?.day;
      if (at) lc.createSeriesMarkers(s, [{ time: at, position: "belowBar", color: GOLD, shape: "arrowUp", text: "매수" }]);
      chart.timeScale().fitContent();
      // 그려질 시간을 조금 준 뒤 찍습니다.
      await new Promise((r) => setTimeout(r, 400));
      if (gone || !chart) return;
      const url = chart.takeScreenshot().toDataURL("image/png");
      await saveBuyChart(entryId, url).catch(() => undefined);
      if (!gone) setImage(url);
    })();
    return () => { gone = true; chart?.remove(); };
  }, [image, bars, buyDay, buyPrice, stop, target, entryId]);

  if (image) return <img className="buy-shot" src={image} alt={`${buyDay} 매수 당시 차트`} />;
  if (bars.length < 5) return <p className="muted">매수일까지의 일봉이 아직 없어요. 워커가 받아 오면 다음에 열 때 그림으로 남겨요.</p>;
  return <div ref={box} className="buy-shot-live" />;
}
