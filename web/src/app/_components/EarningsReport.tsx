"use client";
import { useState } from "react";
import { change, gaugePos, ITEMS, margin, money, quarterLabel, surprise, title, type Report } from "@/lib/earnings";

// 종목 페이지 "실적" 칸: 숫자 표 + AI 해설 + 최근 분기 막대(새 분기는 금색), 미국은 예상 대비도
function Change({ cur, base }: { cur: number | null; base: number | null | undefined }) {
  const c = change(cur, base);
  return c ? <span className={c.tone}>{c.text}</span> : <span className="muted">-</span>;
}

function Gauge({ label, actual, estimate, fmt }: { label: string; actual: number | null; estimate: number | null; fmt: (v: number) => string }) {
  const s = surprise(actual, estimate);
  if (s === null || actual === null || estimate === null) return null;
  return (
    <div className="er-gauge">
      <div className="er-gauge-head">
        <b>{label}</b>
        <span>{fmt(actual)} <span className="muted">예상 {fmt(estimate)}</span></span>
        <span className={`badge ${s >= 0 ? "up" : "down"}`}>예상보다 {s >= 0 ? "높음" : "낮음"} {s >= 0 ? "+" : "−"}{Math.abs(s).toFixed(1)}%</span>
      </div>
      <div className="er-track" role="img" aria-label={`${label} 예상보다 ${s.toFixed(1)}%`}>
        <i className="mid" />
        <i className={`dot ${s >= 0 ? "up" : "down"}`} style={{ left: `${gaugePos(s)}%` }} />
      </div>
    </div>
  );
}

export default function EarningsReport({ report }: { report: Report }) {
  const { data: d, market } = report;
  const hasOp = d.history.filter((h) => h.operating_income !== null).length >= 2;
  const [item, setItem] = useState<"revenue" | "operating_income">("revenue");
  const rows = d.history.filter((h) => h[item] !== null);
  const top = Math.max(...rows.map((h) => Math.abs(h[item] ?? 0)), 1);
  const m = margin(d, "cur");
  const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  const hits = d.surprises.filter((s) => s.eps_pct !== null);
  return (
    <div className="panel er">
      <div className="er-head">
        <b>{title(report)}</b>
        <span className="badge">{report.reported_on.slice(5).replace("-", ".")} 발표</span>
        <a className="muted" href={report.url} target="_blank" rel="noopener noreferrer">{market === "KR" ? "DART" : "SEC"}에서 보기 ›</a>
      </div>
      <div className="er-body">
        <div>
          <div className="table-wrap">
            <table className="er-table">
              <thead><tr><th>{quarterLabel(report.period)}</th><th className="num">이번 분기</th><th className="num">1년 전보다</th><th className="num">지난 분기보다</th></tr></thead>
              <tbody>
                {ITEMS.map(([key, label]) => {
                  const v = d.lines[key];
                  if (!v) return null;
                  return (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className={`num ${v.cur !== null && v.cur < 0 ? "down" : ""}`}>{money(v.cur, market)}</td>
                      <td className="num"><Change cur={v.cur} base={v.yoy} /></td>
                      <td className="num"><Change cur={v.cur} base={v.prev} /></td>
                    </tr>
                  );
                })}
                {d.eps?.actual !== null && d.eps?.actual !== undefined && (
                  <tr><td>EPS</td><td className="num">{usd(d.eps.actual)}</td><td className="num muted">-</td><td className="num muted">-</td></tr>
                )}
                {m !== null && (
                  <tr className="sub">
                    <td>영업이익률</td><td className="num">{Math.round(m)}%</td>
                    <td className="num muted">{margin(d, "yoy") === null ? "-" : `1년 전 ${Math.round(margin(d, "yoy")!)}%`}</td>
                    <td className="num muted">{margin(d, "prev") === null ? "-" : `지난 분기 ${Math.round(margin(d, "prev")!)}%`}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {report.ai && (
            <div className="er-ai">
              <b>왜 이렇게 나왔나</b>
              <p>{report.ai}</p>
              <div className="muted">🤖 AI가 실적 숫자와 최근 뉴스만 읽고 정리했어요. 추측은 넣지 않아요.</div>
            </div>
          )}
        </div>
        <div>
          {market === "US" && (d.revenue_estimate || d.eps?.estimate) && (
            <div className="er-box">
              <div className="label">예상 대비</div>
              <Gauge label="매출" actual={d.lines.revenue?.cur ?? null} estimate={d.revenue_estimate} fmt={(v) => money(v, "US")} />
              <Gauge label="EPS" actual={d.eps?.actual ?? null} estimate={d.eps?.estimate ?? null} fmt={usd} />
              <div className="muted er-note">가운데 회색 선이 증권가 예상이에요. 오른쪽일수록 예상보다 잘 나왔어요.</div>
              {hits.length >= 2 && (
                <div className="er-chips">
                  <span className="muted">최근 {hits.length}번 EPS</span>
                  {hits.map((s) => (
                    <span key={s.period} className={`badge ${s.eps_pct! >= 0 ? "up" : "down"}`}>{quarterLabel(s.period)} {s.eps_pct! >= 0 ? "높음" : "낮음"}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {rows.length >= 2 && (
            <div className="er-box">
              <div className="er-bars-head">
                <span className="label">{item === "revenue" ? "매출" : "영업이익"} · 최근 {rows.length}분기 · 새 분기는 금색</span>
                {hasOp && (
                  <div className="segment" role="tablist" aria-label="막대 항목">
                    {([["revenue", "매출"], ["operating_income", "영업이익"]] as const).map(([k, l]) => (
                      <button key={k} type="button" role="tab" aria-selected={item === k} onClick={() => setItem(k)}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="st-bar-row" role="img" aria-label={rows.map((h) => `${quarterLabel(h.period)} ${money(h[item], market)}`).join(", ")}>
                {rows.map((h, i) => (
                  <div key={h.period} className="st-bar">
                    <span className="num">{money(h[item], market)}</span>
                    <i className={(h[item] ?? 0) < 0 ? "neg" : i === rows.length - 1 ? "gold" : "old"} style={{ height: `${Math.max(4, (Math.abs(h[item] ?? 0) / top) * 100)}%` }} />
                    <em>{quarterLabel(h.period)}</em>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="muted st-note">
        {market === "KR" ? "DART 잠정실적 공시 · 지난 분기 막대는 재무제표 분기 값" : "Finnhub 실적 발표(실제·예상) · 분기는 회사 회계연도 기준"}
      </div>
    </div>
  );
}
