"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import {
  MARKETS, MAX_OVERLAY, OVERLAY_COLORS, PERIODS, cardData, dir, fmtChange, fmtValue, indexed, isDoubleTap, metaOf, sparkPath,
  type CardData, type Period, type Point, type Tab,
} from "@/lib/markets";

// 매크로 환경 › 국내·해외 지수. 카드를 두 번 누르면 그 지수가 위에 크게 나오고, 아래 카드를 누르면 큰 차트에 겹쳐 봐요.
const MUTED = "#9b968b", GRID = "#1b1b1f", BORDER = "#26262b";
const W = 200, H = 44;

type Status = { at: string; errors?: Record<string, string> } | null;

const load = <T extends string>(key: string, ok: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(key) as T | null; return v && ok.includes(v) ? v : fallback; } catch { return fallback; }
};
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* 저장이 막혀도 화면은 그대로 써요 */ } };

export default function MarketBoard({ series, status }: { series: Record<string, Point[]>; status: Status }) {
  const [tab, setTab] = useState<Tab>("KR");
  const [period, setPeriod] = useState<Period>("3m");
  const [focus, setFocus] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string[]>([]);
  const lastTap = useRef<{ code: string; at: number } | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab(load("mk_tab", ["KR", "US"] as const, "KR"));
    setPeriod(load("mk_period", ["1m", "3m", "1y"] as const, "3m"));
  }, []);
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocus(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const cards = useMemo(() => Object.fromEntries(MARKETS.map((m) => [m.code, cardData(m, series[m.code] ?? [], period)])), [series, period]);
  const pickTab = (t: Tab) => { setTab(t); save("mk_tab", t); };
  const pickPeriod = (p: Period) => { setPeriod(p); save("mk_period", p); };

  const open = (code: string) => {
    setFocus(code);
    setOverlay((o) => o.filter((c) => c !== code));
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const toggle = (code: string) => setOverlay((o) => (o.includes(code) ? o.filter((c) => c !== code) : o.length >= MAX_OVERLAY ? o : [...o, code]));
  const tap = (code: string) => {
    const now = Date.now();
    const double = isDoubleTap(lastTap.current, code, now);
    lastTap.current = double ? null : { code, at: now };
    if (double) return open(code);
    // 크게 보는 중에는 한 번 누르면 겹쳐 보기를 켜고 꺼요. 두 번째 누름이 오면 open이 되돌려요.
    if (focus && code !== focus) toggle(code);
  };

  const shown = MARKETS.filter((m) => m.tab === tab && m.code !== focus);
  const missing = Object.keys(status?.errors ?? {}).map((c) => metaOf(c)?.name ?? c);
  const empty = MARKETS.every((m) => !(series[m.code]?.length));

  return (
    <section className="mk" ref={top}>
      <div className="mk-tools">
        <div className="segment" role="tablist" aria-label="국내·해외">
          {(["KR", "US"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => pickTab(t)}>{t === "KR" ? "국내" : "해외"}</button>)}
        </div>
        <div className="segment" role="tablist" aria-label="기간">
          {PERIODS.map((p) => <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => pickPeriod(p.key)}>{p.label}</button>)}
        </div>
        <span className="muted mk-hint">{focus ? "아래 카드를 누르면 겹쳐 보고, 두 번 누르면 그 지수로 바꿔요" : "카드를 두 번 누르면 크게 봐요"}</span>
      </div>

      {empty && <p className="card muted">지수 데이터가 아직 없어요. 업데이트 뒤 워커가 처음 돌 때(몇 분 안에) 2년 치를 받아 와요.</p>}

      {focus && cards[focus] && (
        <Focus main={cards[focus]} overlay={overlay} cards={cards} period={period} onClose={() => setFocus(null)} onRemove={toggle} />
      )}

      <div className={`mk-grid${focus ? " small" : ""}`}>
        {shown.map((m) => {
          const k = overlay.indexOf(m.code);
          return <Card key={m.code} c={cards[m.code]} period={period} color={k >= 0 ? OVERLAY_COLORS[k + 1] : null} onTap={() => tap(m.code)} />;
        })}
      </div>
      {missing.length > 0 && <p className="muted mk-small">이번에 못 받은 지수: {missing.join(", ")} · 다음 차례(30분 뒤)에 다시 받아요.</p>}
      {!empty && <p className="muted mk-small">야후 파이낸스·한국은행·FRED 일봉이에요. 30분마다 새로 받아요. 국고채·미국 2년 금리는 하루 늦게 나와요.</p>}
    </section>
  );
}

function Card({ c, period, color, onTap }: { c: CardData; period: Period; color: string | null; onTap: () => void }) {
  const { meta } = c;
  const label = PERIODS.find((p) => p.key === period)!.label;
  const spark = sparkPath(c.points, W, H, meta.ref);
  const d = dir(meta, c.period);
  return (
    <button type="button" className={`mk-card${color ? " on" : ""}`} style={color ? { borderColor: color } : undefined} onClick={onTap}
      aria-label={`${meta.name} ${c.last ? fmtValue(meta, c.last.close) : "데이터 없음"}`}>
      <span className="mk-name">{color && <i className="mk-dot" style={{ background: color }} />}{meta.name}</span>
      {c.last ? (
        <>
          <span className="mk-val"><strong className="num">{fmtValue(meta, c.last.close)}</strong> <span className={`num ${dir(meta, c.day)}`}>{fmtChange(meta, c.day)}</span></span>
          <svg className="mk-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {spark.refY !== null && <line className="ref" x1="0" x2={W} y1={spark.refY} y2={spark.refY} />}
            {spark.line && <polyline className={`line ${d || "flat"}`} points={spark.line} />}
          </svg>
          <span className="mk-sub muted">{label} <span className={`num ${d}`}>{fmtChange(meta, c.period)}</span>{meta.hint && <> · {meta.hint}</>}</span>
        </>
      ) : <span className="mk-sub muted">아직 데이터가 없어요</span>}
    </button>
  );
}

function Focus({ main, overlay, cards, period, onClose, onRemove }: {
  main: CardData; overlay: string[]; cards: Record<string, CardData>; period: Period; onClose: () => void; onRemove: (code: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { meta } = main;
  const label = PERIODS.find((p) => p.key === period)!.label;
  const lines = useMemo(() => {
    if (!overlay.length) return null;
    const from = main.points[0]?.day ?? "";
    return [main, ...overlay.map((c) => cards[c])].map((c, k) => ({
      code: c.meta.code, name: c.meta.name, color: OVERLAY_COLORS[k],
      points: indexed(c.points, from),
    }));
  }, [main, overlay, cards, period]);

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
        grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
        rightPriceScale: { borderColor: BORDER, scaleMargins: { top: 0.1, bottom: 0.08 } },
        timeScale: { borderColor: BORDER, rightOffset: 2 },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
        handleScroll: false, handleScale: false,
      });
      if (lines) {
        for (const l of lines) {
          const s = chart.addSeries(lc.LineSeries, {
            color: l.color, lineWidth: 2, title: l.name, priceLineVisible: false, lastValueVisible: true,
            priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
          });
          s.setData(l.points.map((p) => ({ time: p.day as Time, value: p.close })));
        }
        const s100 = chart.addSeries(lc.LineSeries, { color: "transparent", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        const ends = [main.points[0], main.points.at(-1)].filter(Boolean) as Point[];
        s100.setData(ends.map((p) => ({ time: p.day as Time, value: 100 })));
        s100.createPriceLine({ price: 100, color: "#4a3f28", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: false, title: "" });
      } else {
        const up = (main.period?.abs ?? 0) >= 0;
        const color = up ? "#e8806f" : "#86a8e6";
        const s = chart.addSeries(lc.AreaSeries, {
          lineColor: color, lineWidth: 2, topColor: up ? "rgba(232,128,111,0.22)" : "rgba(134,168,230,0.22)", bottomColor: "rgba(0,0,0,0)",
          priceLineVisible: false, priceFormat: { type: "custom", formatter: (v: number) => fmtValue(meta, v), minMove: 0.01 },
        });
        s.setData(main.points.map((p) => ({ time: p.day as Time, value: p.close })));
        if (meta.ref !== undefined) s.createPriceLine({ price: meta.ref, color: "#4a3f28", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "" });
      }
      chart.timeScale().fitContent();
    })();
    return () => { disposed = true; chart?.remove(); };
  }, [main, lines, meta]);

  return (
    <div className="card mk-focus">
      <div className="mk-focus-head">
        <div>
          <div className="muted">{meta.name}</div>
          {main.last && (
            <div className="mk-focus-val">
              <strong className="num">{fmtValue(meta, main.last.close)}</strong>
              <span className={`num ${dir(meta, main.day)}`}>하루 {fmtChange(meta, main.day)}</span>
              <span className={`num ${dir(meta, main.period)}`}>{label} {fmtChange(meta, main.period)}</span>
              <span className="muted">{main.last.day.slice(5).replace("-", ".")} 기준</span>
            </div>
          )}
        </div>
        <button type="button" className="ghost mk-close" onClick={onClose}>✕ 격자로</button>
      </div>
      {lines && (
        <div className="mk-legend">
          {lines.map((l, k) => {
            const last = l.points.at(-1)?.close;
            return (
              <span key={l.code} className="mk-chip">
                <i className="mk-dot" style={{ background: l.color }} />{l.name}
                {last !== undefined && <span className={`num ${last > 100 ? "up" : last < 100 ? "down" : ""}`}>{last >= 100 ? "+" : ""}{(last - 100).toFixed(1)}%</span>}
                {k > 0 && <button type="button" aria-label={`${l.name} 빼기`} onClick={() => onRemove(l.code)}>✕</button>}
              </span>
            );
          })}
          <span className="muted mk-small">{label} 전 첫날을 100으로 맞춰 겹쳤어요</span>
        </div>
      )}
      <div className="mk-big" ref={box} role="img" aria-label={`${meta.name} ${label} 차트${lines ? `, ${lines.slice(1).map((l) => l.name).join(", ")} 겹쳐 보기` : ""}`} />
    </div>
  );
}
