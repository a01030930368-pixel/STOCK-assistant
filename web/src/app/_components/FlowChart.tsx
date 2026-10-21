"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cumulative, money, streak, streakText, total, WHO, type FlowRow } from "@/lib/flows";

const SPANS = [{ n: 5, label: "5일" }, { n: 20, label: "20일" }, { n: 60, label: "60일" }];
export type StockTheme = { code: string; name: string; change_pct: number | null };

// 종목 페이지: 외국인·기관·개인 누적 순매수 선 + 한 줄 요약
export default function FlowChart({ rows, themes, at }: { rows: FlowRow[]; themes: StockTheme[]; at: string | null }) {
  const [span, setSpan] = useState(20);
  const part = rows.slice(-span);

  return (
    <div className="panel flow">
      <div className="flow-head">
        <span className="label">투자자별 누적 순매수</span>
        {at && <span className="muted flow-at">{at} 마감 기준</span>}
        <div className="segment small" role="tablist" aria-label="기간">
          {SPANS.map((s) => <button key={s.n} type="button" role="tab" aria-selected={span === s.n} onClick={() => setSpan(s.n)}>{s.label}</button>)}
        </div>
      </div>
      {part.length < 2 ? (
        <p className="muted flow-empty">아직 수급 기록이 없어요. 워커가 장 마감 뒤 하루 한 번 받아 와요(보유·관심 국내 종목).</p>
      ) : (
        <>
          <div className="flow-chips">
            {WHO.map((w) => {
              const s = streakText(streak(part, w.key));
              return (
                <span key={w.key} className="flow-chip">
                  <b style={{ color: w.color }}>{w.label}</b>
                  <span className={total(part, w.key) > 0 ? "up" : total(part, w.key) < 0 ? "down" : ""}>{money(total(part, w.key))}</span>
                  {s && <span className="muted">· {s}</span>}
                </span>
              );
            })}
          </div>
          <Lines rows={part} />
          <p className="chart-foot">선이 올라가면 그 투자자가 사 모은 것, 내려가면 판 것이에요. 점선은 주가예요. 금액은 키움 순매수 금액(장 마감 기준)이에요.</p>
        </>
      )}
      {themes.length > 0 && (
        <div className="flow-themes">
          <span className="muted">이 종목이 든 테마</span>
          {themes.map((t) => (
            <Link key={t.code} href="/macro/themes" className="flow-theme">
              {t.name}
              {t.change_pct !== null && <span className={t.change_pct > 0 ? "up" : t.change_pct < 0 ? "down" : "muted"}> {t.change_pct > 0 ? "+" : t.change_pct < 0 ? "−" : ""}{Math.abs(t.change_pct).toFixed(1)}%</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Lines({ rows }: { rows: FlowRow[] }) {
  // 실제 너비로 그려야 폰에서도 글자가 작아지지 않아요.
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref}>{W > 0 && <LinesAt rows={rows} W={W} />}</div>;
}

function LinesAt({ rows, W }: { rows: FlowRow[]; W: number }) {
  const narrow = W < 500;
  const H = narrow ? 230 : 300, L = 4, R = narrow ? 92 : 124, T = 12, B = 22;
  const series = WHO.map((w) => ({ ...w, values: cumulative(rows, w.key) }));
  const all = series.flatMap((s) => s.values).concat(0);
  const hi = Math.max(...all), lo = Math.min(...all), pad = (hi - lo || 1) * 0.08;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + ((hi + pad - v) / (hi - lo + pad * 2)) * (H - T - B);
  const ph = Math.max(...rows.map((r) => r.close)), pl = Math.min(...rows.map((r) => r.close));
  const yp = (v: number) => T + ((ph - v) / (ph - pl || 1)) * (H - T - B);
  const ticks = [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
  // 오른쪽 이름표가 겹치지 않게 아래로 밀어요.
  const labels = series.map((s) => ({ s, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 16);
  return (
    <svg width={W} height={H} className="flow-svg" role="img" aria-label={series.map((s) => `${s.label} ${money(s.values[s.values.length - 1])}`).join(", ")}>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="flow-zero" />
      <polyline className="flow-price" points={rows.map((r, i) => `${x(i)},${yp(r.close)}`).join(" ")} />
      {series.map((s) => <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />)}
      {labels.map(({ s, y: ly }) => (
        <text key={s.key} x={W - R + 8} y={ly + 4} fill={s.color} className="flow-label">{narrow ? "" : `${s.label} `}{money(s.values[s.values.length - 1])}</text>
      ))}
      {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} className="flow-tick" textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}>{rows[i].day.slice(5).replace("-", ".")}</text>)}
    </svg>
  );
}
