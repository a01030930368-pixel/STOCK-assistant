"use client";
import { useEffect, useRef, useState } from "react";

// 같은 날 0%에서 출발한 수익률 선 여러 개(두 종목 비교, 매매 복기). 손가락·마우스를 올리면 그날 값이 보여요.
export type Series = { label: string; color: string; values: (number | null)[]; dashed?: boolean };
export type Mark = { i: number; kind: "buy" | "sell"; series: number };

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const md = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8))}`;

export default function ReturnChart({ days, series, marks = [] }: { days: string[]; series: Series[]; marks?: Mark[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="rchart">{W > 0 && days.length > 1 && <Plot days={days} series={series} marks={marks} W={W} />}</div>;
}

function Plot({ days, series, marks, W }: { days: string[]; series: Series[]; marks: Mark[]; W: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const narrow = W < 560;
  const H = narrow ? 240 : 340, L = 4, R = narrow ? 64 : 150, T = 14, B = 22;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null)).concat(0);
  const hi = Math.max(...all), lo = Math.min(...all), pad = (hi - lo || 1) * 0.08;
  const n = days.length;
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + ((hi + pad - v) / (hi - lo + pad * 2)) * (H - T - B);
  const last = (s: Series) => [...s.values].reverse().find((v): v is number => v !== null) ?? null;
  const labels = series.map((s, k) => ({ s, k, v: last(s) })).filter((l) => l.v !== null).map((l) => ({ ...l, y: y(l.v!) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 16);
  const ticks = [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1];
  const path = (vals: (number | null)[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - L) / (W - L - R)) * (n - 1));
    setHover(i < 0 || i >= n ? null : i);
  };
  const tipLeft = hover !== null && x(hover) > (W - R) / 2;
  return (
    <div className="rchart-box">
      <svg width={W} height={H} role="img" aria-label={series.map((s) => `${s.label} ${last(s) === null ? "-" : pct(last(s)!)}`).join(", ")}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="flow-zero" />
        {series.map((s, k) => (
          <path key={k} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? "4 4" : undefined} />
        ))}
        {marks.map((m, k) => {
          const v = series[m.series]?.values[m.i];
          if (v === null || v === undefined) return null;
          return (
            <g key={k}>
              <circle cx={x(m.i)} cy={y(v)} r={5.5} fill={m.kind === "buy" ? "var(--up)" : "var(--down)"} stroke="var(--bg)" strokeWidth={2} />
              {!narrow && <text x={Math.min(Math.max(x(m.i), L + 14), W - R - 14)} y={y(v) + (m.kind === "buy" ? 18 : -10)} textAnchor="middle" className="rchart-mark" fill={m.kind === "buy" ? "var(--up)" : "var(--down)"}>{m.kind === "buy" ? "매수" : "매도"}</text>}
            </g>
          );
        })}
        {labels.map((l) => (
          <text key={l.k} x={W - R + 8} y={l.y + 4} fill={l.s.color} className="flow-label">{narrow ? "" : `${l.s.label} `}{pct(l.v!)}</text>
        ))}
        {ticks.map((i, k) => <text key={k} x={x(i)} y={H - 6} className="flow-tick" textAnchor={k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}>{md(days[i])}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="rchart-cross" />}
        {hover !== null && series.map((s, k) => s.values[hover] !== null && <circle key={k} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />)}
      </svg>
      {hover !== null && (
        <div className="rchart-tip" style={tipLeft ? { right: W - x(hover) + 10 } : { left: x(hover) + 10 }}>
          <b>{days[hover].replace(/-/g, ".")}</b>
          {series.map((s, k) => (
            <span key={k}><i style={{ background: s.color }} />{s.label} {s.values[hover] === null ? "-" : pct(s.values[hover]!)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
