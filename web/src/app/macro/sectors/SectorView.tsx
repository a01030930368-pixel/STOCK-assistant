"use client";
import { useEffect, useRef, useState } from "react";
import { heat, PERIODS, signed, treemap, type Period, type SectorRow } from "@/lib/sectors";

export type MarketData = { rows: SectorRow[]; updated: string | null; error: string | null; held: number };

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export default function SectorView({ kr, us }: { kr: MarketData; us: MarketData }) {
  const [market, setMarket] = useState<"KR" | "US">(kr.rows.length || !us.rows.length ? "KR" : "US");
  const [period, setPeriod] = useState<Period>("d1");
  const [picked, setPicked] = useState<string | null>(null);
  const data = market === "KR" ? kr : us;
  const rows = [...data.rows].sort((a, b) => (b.ret[period] ?? -Infinity) - (a.ret[period] ?? -Infinity));

  const pick = (code: string) => {
    setPicked(code);
    document.getElementById(`sector-${code}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      <div className="sector-tools">
        <div className="segment small" role="tablist" aria-label="시장">
          {([["KR", "국내"], ["US", "미국"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={market === k} onClick={() => { setMarket(k); setPicked(null); }}>{label}</button>
          ))}
        </div>
        <div className="segment small" role="tablist" aria-label="기간">
          {PERIODS.map((p) => <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
        </div>
        <span className="muted sector-note">
          {market === "KR" ? "코스피 업종지수" : "S&P 500 섹터 ETF"}
          {data.updated && ` · ${when(data.updated)} 기준`} · 네모 크기 = {market === "KR" ? "시가총액 비중" : "S&P 500 안 비중(대략)"} · <span className="mine-dot" /> 내 종목
        </span>
      </div>

      {data.error && <p className="callout">최근 갱신이 실패해서 예전 값을 보여 드려요. ({data.error})</p>}
      {rows.length === 0 ? (
        <p className="card muted">
          {market === "KR"
            ? "아직 국내 섹터 값이 없어요. 키움 키가 있으면 워커가 장중 10분마다, 장이 닫혀 있으면 3시간마다 받아 와요."
            : "아직 미국 섹터 값이 없어요. 워커가 장중 15분마다, 장이 닫혀 있으면 3시간마다 받아 와요."}
        </p>
      ) : (
        <>
          <SectorMap rows={rows} period={period} picked={picked} onPick={pick} />
          <div className="panel sector-table">
            <div className="table-scroll">
              <table className="heat">
                <thead>
                  <tr>
                    <th>섹터</th>
                    {PERIODS.map((p) => (
                      <th key={p.key} className="c">
                        <button type="button" className={period === p.key ? "sort on" : "sort"} onClick={() => setPeriod(p.key)}>{p.label}{period === p.key ? " ▼" : ""}</button>
                      </th>
                    ))}
                    <th>오늘 많이 움직인 종목</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} id={`sector-${r.code}`} className={picked === r.code ? "picked" : undefined} onClick={() => setPicked(r.code)}>
                      <td className="name">
                        <b>{r.name}</b>{market === "US" && <span className="muted code"> {r.code}</span>}
                        {r.mine && <span className="mine" title={r.mine.names.join(", ")}>내 종목 {r.mine.count} · {r.mine.pct}%</span>}
                      </td>
                      {PERIODS.map((p) => <td key={p.key} className="c" style={{ background: heat(r.ret[p.key], p.key) }}>{signed(r.ret[p.key])}</td>)}
                      <td className="muted leaders">{r.leaders.map((l) => `${l.name} ${signed(l.pct)}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="chart-foot">
            1주·1달·3달은 그만큼 전 종가와, 올해는 작년 마지막 종가와 지금 값을 비교해요. 기록이 모자라면 &quot;–&quot;로 보여요.
            {data.held > 0 && (market === "KR" ? " 내 종목은 키움 종목 정보의 업종 이름으로 묶어요(코스닥 종목은 빠질 수 있어요)." : " 내 종목은 종목 업종으로 대략 묶어요.")}
          </p>
        </>
      )}
    </>
  );
}

function SectorMap({ rows, period, picked, onPick }: { rows: SectorRow[]; period: Period; picked: string | null; onPick: (code: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const known = rows.some((r) => r.weight);
  const boxes = size.w ? treemap(rows.map((r) => ({ weight: known ? r.weight ?? 0 : 1, item: r })), 0, 0, size.w, size.h) : [];
  return (
    <div className="panel sector-map-wrap">
      <div className="sector-map" ref={ref} role="list" aria-label="섹터 지도">
        {boxes.map(({ item: r, x, y, w, h }) => {
          const tiny = w < 84 || h < 54, small = w < 130 || h < 80;
          const v = r.ret[period];
          return (
            <button key={r.code} type="button" role="listitem" className={`tile${tiny ? " tiny" : small ? " small" : ""}${picked === r.code ? " picked" : ""}`}
              style={{ left: x, top: y, width: Math.max(0, w - 3), height: Math.max(0, h - 3), background: heat(v, period) ?? "var(--surface-2)" }}
              title={`${r.name} ${signed(v)}`} onClick={() => onPick(r.code)}>
              <span className="tile-name">{r.name}{r.mine && <span className="mine-dot" />}</span>
              <span className="tile-pct">{signed(v)}</span>
            </button>
          );
        })}
      </div>
      {!known && <p className="muted sector-small">비중을 아직 못 받아 네모 크기를 같게 그렸어요.</p>}
    </div>
  );
}
