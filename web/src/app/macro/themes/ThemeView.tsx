"use client";
import { useEffect, useRef, useState } from "react";
import { heat, signed, treemap } from "@/lib/sectors";

export type ThemeRow = { code: string; name: string; stocks: number; today: number; week: number | null; rising: number; falling: number; leader: string; mine: string[] };
type Span = "today" | "week";

const MAP_COUNT = 24; // 지도에는 많이 움직인 테마만 그려요(전부 그리면 네모가 너무 작아요).
const PAGE = 30;
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const value = (t: ThemeRow, span: Span) => (span === "today" ? t.today : t.week);

export default function ThemeView({ themes, updated, error }: { themes: ThemeRow[]; updated: string | null; error: string | null }) {
  const [span, setSpan] = useState<Span>("today");
  const [onlyMine, setOnlyMine] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const hasMine = themes.some((t) => t.mine.length);
  const list = themes.filter((t) => !onlyMine || t.mine.length).sort((a, b) => (value(b, span) ?? -Infinity) - (value(a, span) ?? -Infinity));
  const shown = all || onlyMine ? list : list.slice(0, PAGE);
  const mapped = [...list].sort((a, b) => Math.abs(value(b, span) ?? 0) - Math.abs(value(a, span) ?? 0)).slice(0, MAP_COUNT);

  const pick = (code: string) => {
    const i = list.findIndex((t) => t.code === code);
    if (i >= PAGE) setAll(true);
    setPicked(code);
    setTimeout(() => document.getElementById(`theme-${code}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  return (
    <>
      <div className="sector-tools">
        <div className="segment small" role="tablist" aria-label="기간">
          {([["today", "오늘"], ["week", "1주"]] as const).map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={span === k} onClick={() => setSpan(k)}>{label}</button>)}
        </div>
        {hasMine && (
          <div className="segment small" role="tablist" aria-label="보기">
            <button type="button" role="tab" aria-selected={!onlyMine} onClick={() => setOnlyMine(false)}>전체</button>
            <button type="button" role="tab" aria-selected={onlyMine} onClick={() => setOnlyMine(true)}>내 종목 테마만</button>
          </div>
        )}
        <span className="muted sector-note">
          국내 · 키움 테마 {themes.length}개{updated && ` · ${when(updated)} 기준`} · 네모 크기 = 테마 종목 수 · <span className="mine-dot" /> 내 종목
        </span>
      </div>

      {error && <p className="callout">최근 갱신이 실패해서 예전 값을 보여 드려요. ({error})</p>}
      {themes.length === 0 ? (
        <p className="card muted">아직 테마 값이 없어요. 키움 키가 있으면 워커가 장중 10분마다, 장이 닫혀 있으면 3시간마다 받아 와요.</p>
      ) : (
        <>
          <ThemeMap themes={mapped} span={span} picked={picked} onPick={pick} />
          <div className="panel sector-table theme-table">
            <div className="table-scroll">
              <table className="heat">
                <thead>
                  <tr><th>테마</th><th className="c">오늘</th><th className="c">1주</th><th className="c">오른 종목</th><th className="leaders">주요 종목</th></tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.code} id={`theme-${t.code}`} className={picked === t.code ? "picked" : undefined} onClick={() => setPicked(t.code)}>
                      <td className="name"><b>{t.name}</b>{t.mine.length > 0 && <span className="mine" title={t.mine.join(", ")}>내 종목 {t.mine.length}</span>}</td>
                      <td className="c" style={{ background: heat(t.today, "d1") }}>{signed(t.today)}</td>
                      <td className="c" style={{ background: heat(t.week, "w1") }}>{signed(t.week)}</td>
                      <td className="c"><span className="up">{t.rising}</span><span className="muted"> / {t.stocks}</span></td>
                      <td className="muted leaders">{t.leader}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!all && !onlyMine && list.length > PAGE && <button type="button" className="ghost more" onClick={() => setAll(true)}>테마 {list.length - PAGE}개 더 보기</button>}
          </div>
          <p className="chart-foot">1주는 5거래일 수익률이에요. 오른 종목은 테마 안에서 오늘 오른 종목 수예요. 지도에는 많이 움직인 {MAP_COUNT}개만 그려요.</p>
        </>
      )}
    </>
  );
}

function ThemeMap({ themes, span, picked, onPick }: { themes: ThemeRow[]; span: Span; picked: string | null; onPick: (code: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const boxes = size.w ? treemap(themes.map((t) => ({ weight: Math.max(1, t.stocks), item: t })), 0, 0, size.w, size.h) : [];
  return (
    <div className="panel sector-map-wrap">
      <div className="sector-map" ref={ref} role="list" aria-label="테마 지도">
        {boxes.map(({ item: t, x, y, w, h }) => {
          const tiny = w < 84 || h < 54, small = w < 130 || h < 80, bare = w < 44 || h < 34;
          const v = value(t, span);
          return (
            <button key={t.code} type="button" role="listitem" className={`tile${tiny ? " tiny" : small ? " small" : ""}${picked === t.code ? " picked" : ""}`}
              style={{ left: x, top: y, width: Math.max(0, w - 3), height: Math.max(0, h - 3), background: heat(v, span === "today" ? "d1" : "w1") ?? "var(--surface-2)" }}
              title={`${t.name} ${signed(v)}`} onClick={() => onPick(t.code)}>
              {!bare && <span className="tile-name">{t.name}{t.mine.length > 0 && <span className="mine-dot" />}</span>}
              {!bare && <span className="tile-pct">{signed(v)}</span>}
              {!small && h >= 110 && t.leader && <span className="tile-sub">{t.leader}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
