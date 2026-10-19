"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addChartMemo, deleteChartMemo } from "@/app/actions";

export type PricePoint = { day: string; close: number };
export type Memo = { id: number; day: string; body: string };

const RANGES = [
  { key: "3m", label: "3개월", days: 92 },
  { key: "6m", label: "6개월", days: 183 },
  { key: "1y", label: "1년", days: 366 },
] as const;

const PAD = { l: 8, r: 64, t: 16, b: 26 };

const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const md = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;

// 메모 날짜가 휴장일이면 그 전 가장 가까운 거래일 위에 표시합니다.
function nearestIndex(points: PricePoint[], day: string) {
  let found = -1;
  for (let i = 0; i < points.length && points[i].day <= day; i++) found = i;
  return found;
}

export default function ChartMemo({ ticker, market, prices, memos, today }: {
  ticker: string; market: string; prices: PricePoint[]; memos: Memo[]; today: string;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("6m");
  const [hover, setHover] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // 화면 너비에 맞춰 실제 픽셀 크기로 그려서, 폰에서도 글자가 작아지지 않게 합니다.
  const [W, setW] = useState(720);
  const H = W < 500 ? 220 : 260;
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [prices.length > 1]);
  const fmt = (v: number) => (market === "US" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${Math.round(v).toLocaleString("ko-KR")}원`);

  const points = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const from = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
    return prices.filter((p) => p.day >= from);
  }, [prices, range, today]);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const closes = points.map((p) => p.close);
    let lo = Math.min(...closes), hi = Math.max(...closes);
    const pad = (hi - lo || hi * 0.02) * 0.08;
    lo -= pad; hi += pad;
    const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
    const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * (k + 0.5)) / 4);
    const months: number[] = [];
    points.forEach((p, i) => { if (i > 0 && p.day.slice(5, 7) !== points[i - 1].day.slice(5, 7)) months.push(i); });
    return { x, y, path, ticks, months };
  }, [points, W, H]);

  const marks = useMemo(() => {
    const byIndex = new Map<number, Memo[]>();
    for (const m of memos) {
      const i = nearestIndex(points, m.day);
      if (i >= 0 && m.day >= points[0].day) byIndex.set(i, [...(byIndex.get(i) ?? []), m]);
    }
    return byIndex;
  }, [memos, points]);

  const indexAt = (clientX: number) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };

  const hp = hover !== null ? points[hover] : null;
  const hoverMemos = hover !== null ? marks.get(hover) ?? [] : [];

  return (
    <>
      <div className="chart-head">
        <div className="segment small" role="tablist">
          {RANGES.map((r) => (
            <button key={r.key} type="button" role="tab" aria-selected={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
        {points.length > 0 && (
          <span className="muted">
            {fmt(points[points.length - 1].close)}{" "}
            <span className={points[points.length - 1].close >= points[0].close ? "up" : "down"}>
              {signed(((points[points.length - 1].close / points[0].close) - 1) * 100)}
            </span>
          </span>
        )}
      </div>

      {!geo ? (
        <p className="muted">아직 가격 기록이 없습니다. 워커가 다음 수집 때(최대 12시간) 일봉을 받아 오고, 그 뒤로는 매일 종가가 쌓입니다.</p>
      ) : (
        <div className="chart-box" ref={box}>
          <svg
            ref={svg} viewBox={`0 0 ${W} ${H}`} className="price-chart" role="img"
            aria-label={`${ticker} 종가 차트, ${points[0].day}부터 ${points[points.length - 1].day}까지`}
            onPointerMove={(e) => setHover(indexAt(e.clientX))}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => setDay(points[indexAt(e.clientX)].day)}
          >
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} className="grid" />
                <text x={W - PAD.r + 8} y={geo.y(t) + 4} className="axis">{fmt(t)}</text>
              </g>
            ))}
            {geo.months.map((i) => (
              <text key={i} x={geo.x(i)} y={H - 8} className="axis" textAnchor="middle">{Number(points[i].day.slice(5, 7))}월</text>
            ))}
            <path d={geo.path} className="line" />
            {[...marks.keys()].map((i) => (
              <circle key={i} cx={geo.x(i)} cy={geo.y(points[i].close)} r={5} className="memo-dot" />
            ))}
            {hp && hover !== null && (
              <>
                <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.t} y2={H - PAD.b} className="cross" />
                <circle cx={geo.x(hover)} cy={geo.y(hp.close)} r={4} className="hover-dot" />
              </>
            )}
          </svg>
          {hp && hover !== null && (
            <div className="chart-tip" style={{ left: `${(geo.x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})` }}>
              <div className="label">{hp.day}</div>
              <div><b>{fmt(hp.close)}</b></div>
              {hoverMemos.map((m) => <div key={m.id} className="tip-memo">{m.body}</div>)}
              <div className="label">누르면 이 날짜에 메모</div>
            </div>
          )}
        </div>
      )}

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
