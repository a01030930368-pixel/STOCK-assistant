"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import type { Candle } from "@/lib/candles";
import type { StatementRow } from "@/lib/statements";
import { bandSentence, buildBand, perShare, times, type BandKind } from "@/lib/bands";

// 차트의 "PER 밴드 / PBR 밴드" 화면. 주봉 위에 주당 값 × 다섯 배수 선을 깔아요.
const UP = "#e8806f", DOWN = "#86a8e6", MUTED = "#9b968b", LINE = "#1b1b1f";
const COLORS = ["#5b7fbf", "#6f9bd6", "#9b968b", "#d9a35e", "#e8806f"];
const YEARS = [{ key: 3, label: "3년" }, { key: 5, label: "5년" }, { key: null, label: "전체" }] as const;

export default function BandChart({ kind, candles, statements, shares, market, current, fmt }: {
  kind: BandKind; candles: Candle[]; statements: StatementRow[]; shares: number | null; market: string; current: number | null; fmt: (v: number) => string;
}) {
  const [years, setYears] = useState<number | null>(3);
  const box = useRef<HTMLDivElement>(null);
  const name = kind === "per" ? "PER" : "PBR";
  const points = useMemo(() => (shares ? perShare(statements, shares, kind) : []), [statements, shares, kind]);
  const band = useMemo(() => buildBand(candles, points, years, current), [candles, points, years, current]);
  const latest = points.at(-1)?.value ?? null;

  useEffect(() => {
    if (!box.current || !band) return;
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
        rightPriceScale: { borderColor: "#26262b", scaleMargins: { top: 0.08, bottom: 0.06 } },
        timeScale: { borderColor: "#26262b", rightOffset: 4 },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
      });
      const priceFormat = { type: "custom" as const, formatter: fmt, minMove: market === "US" ? 0.01 : 1 };
      band.lines.forEach((l, k) => {
        const s = chart!.addSeries(lc.LineSeries, {
          color: COLORS[k], lineWidth: 2, lineStyle: k === 2 ? lc.LineStyle.Dashed : lc.LineStyle.Solid, title: times(l.mult),
          priceLineVisible: false, crosshairMarkerVisible: false, priceFormat,
        });
        s.setData(band.bars.flatMap((b, i) => (l.values[i] === null ? [] : [{ time: b.day as Time, value: l.values[i]! }])));
      });
      const price = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceFormat,
      });
      price.setData(band.bars.map((b) => ({ time: b.day as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
      chart.timeScale().fitContent();
    })();
    return () => { disposed = true; chart?.remove(); };
  }, [band, fmt, market]);

  const unavailable = !shares
    ? "주식 수를 아직 못 받았어요. 워커가 재무제표를 받을 때(최대 12시간) 같이 받아 와요."
    : latest !== null && latest <= 0
      ? kind === "per" ? "최근 1년 순이익이 적자라 PER을 셀 수 없어요. PBR 밴드를 보세요." : "자본이 0 이하라 PBR을 셀 수 없어요."
      : !band ? "밴드를 그릴 만큼 재무제표나 주가 기록이 길지 않아요. 재무제표가 쌓이면 그려져요." : null;

  return (
    <div className="band">
      <div className="band-head">
        <div className="segment small" role="tablist" aria-label="기간">
          {YEARS.map((y) => <button key={y.label} type="button" role="tab" aria-selected={years === y.key} onClick={() => setYears(y.key)}>{y.label}</button>)}
        </div>
        <span className="muted">주봉 · {kind === "per" ? "주가 ÷ 최근 4분기 주당순이익" : "주가 ÷ 주당순자산"}</span>
      </div>
      {unavailable ? <p className="muted band-empty">{unavailable}</p> : band && (
        <div className="band-body">
          <div className="band-canvas" ref={box} role="img" aria-label={`${name} 밴드 ${band.lines.map((l) => times(l.mult)).join(", ")}`} />
          <div className="band-side">
            <div className="stat"><div className="stat-label">지금 {name}</div><div className="stat-value">{band.current === null ? "-" : times(band.current)}</div>
              <div className="stat-sub">{kind === "per" ? "주당순이익" : "주당순자산"} {latest === null ? "-" : fmt(latest)}</div></div>
            <div className="stat"><div className="stat-label">밴드 범위</div><div className="stat-value">{times(band.low)} ~ {times(band.high)}</div>
              <div className="stat-sub">{years ? `지난 ${years}년` : "전체 기간"} 중 위아래 5%는 뺐어요</div></div>
            <p className="band-note">{bandSentence(band, kind, years)}</p>
            <p className="muted band-small">
              주식 수는 지금 값으로 셌어요. 실적은 분기가 끝나고 45일 뒤(사업보고서는 이듬해 3월 말)부터 반영해요.
              {band.since && ` ${band.since.slice(0, 7).replace("-", ".")}부터 그릴 수 있어요.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
