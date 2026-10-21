"use client";
import { useState } from "react";
import { growth, healthCheck, ITEMS, money, previousKey, quarterLabel, ratio, tableOf, type StatementRow, type Tab, type View } from "@/lib/statements";

// 종목 페이지 재무제표: 위에 재무 건강검진 신호등, 아래에 손익·재무상태·현금흐름 탭 표와 최근 5분기 막대
const TABS: [Tab, string, string][] = [["is", "손익계산서", "손익"], ["bs", "재무상태표", "재무상태"], ["cf", "현금흐름표", "현금흐름"]];
const LIGHT = { good: "좋음", watch: "살펴볼 것", bad: "주의" };

function Bars({ rows, item, label, tone, market }: { rows: StatementRow[]; item: string; label: string; tone: string; market: string }) {
  const q = rows.filter((r) => r.kind === "Q" && r.item === item).sort((a, b) => a.period.localeCompare(b.period)).slice(-5);
  if (q.length < 2) return null;
  const max = Math.max(...q.map((r) => Math.abs(r.value))) || 1;
  return (
    <div className="st-bars">
      <div className="label">{label} · 최근 {q.length}분기</div>
      <div className="st-bar-row" role="img" aria-label={`${label} ${q.map((r) => `${quarterLabel(r.period)} ${money(r.value, market)}`).join(", ")}`}>
        {q.map((r) => (
          <div key={r.period} className="st-bar" title={`${quarterLabel(r.period)} ${money(r.value, market)}`}>
            <span className="num">{money(r.value, market)}</span>
            <i className={r.value < 0 ? "neg" : tone} style={{ height: `${Math.max(4, (Math.abs(r.value) / max) * 100)}%` }} />
            <em>{quarterLabel(r.period)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Statements({ rows, market, source }: { rows: StatementRow[]; market: string; source: string }) {
  const [tab, setTab] = useState<Tab>("is");
  const [view, setView] = useState<View>("Y");
  const checks = healthCheck(rows, market);
  const t = tableOf(rows, view);
  const cls = (v: number | null) => (v !== null && v < 0 ? "down" : "");
  const extra = tab === "is"
    ? { label: "영업이익률", values: t.columns.map((c) => ratio(t.get(c.key, "operating_income"), t.get(c.key, "revenue"))) }
    : tab === "bs"
      ? { label: "부채비율", values: t.columns.map((c) => { const e = t.get(c.key, "equity"); return e !== null && e > 0 ? ratio(t.get(c.key, "liabilities"), e) : null; }) }
      : null;
  return (
    <div className="statements">
      {checks.length > 0 && (
        <div className="panel st-health">
          <div className="panel-title">재무 건강검진 <span className="muted">재무제표 숫자로 바로 계산했어요</span></div>
          <ul>
            {checks.map((c) => (
              <li key={c.title}>
                <span className={`st-dot ${c.light}`} aria-label={LIGHT[c.light]} />
                <b>{c.title}</b>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <div className="muted st-legend"><span className="st-dot good" /> 좋음 <span className="st-dot watch" /> 살펴볼 것 <span className="st-dot bad" /> 주의</div>
        </div>
      )}
      <div className="panel">
        <div className="st-head">
          <div className="segment" role="tablist" aria-label="재무제표 종류">
            {TABS.map(([id, long, short]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                <span className="st-long">{long}</span><span className="st-short">{short}</span>
              </button>
            ))}
          </div>
          <div className="segment" role="tablist" aria-label="기간">
            {(["Y", "Q"] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>{v === "Y" ? "연간" : "분기"}</button>
            ))}
          </div>
        </div>
        <div className="st-body">
          <div className="table-wrap st-table">
            {t.columns.length === 0 ? <p className="muted">{view === "Q" ? "분기 값이 아직 없어요." : "연간 값이 아직 없어요."}</p> : (
              <table>
                <thead><tr><th>단위 {market === "US" ? "달러" : "원"}</th>{t.columns.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
                <tbody>
                  {ITEMS[tab].map((it) => {
                    const values = t.columns.map((c) => t.get(c.key, it.item));
                    if (values.every((v) => v === null)) return null;
                    return [
                      <tr key={it.item} className={it.strong ? "strong" : ""}>
                        <td>{it.label}</td>
                        {values.map((v, i) => <td key={t.columns[i].key} className={`num ${cls(v)}`}>{money(v, market)}</td>)}
                      </tr>,
                      it.growth && (
                        <tr key={`${it.item}-g`} className="sub">
                          <td>　1년 전보다</td>
                          {t.columns.map((c) => {
                            const prev = previousKey(c.key);
                            const g = prev ? growth(t.get(c.key, it.item), t.get(prev, it.item)) : null;
                            return <td key={c.key} className={`num ${g === null ? "" : g >= 0 ? "up" : "down"}`}>{g === null ? "" : `${g >= 0 ? "+" : ""}${Math.round(g)}%`}</td>;
                          })}
                        </tr>
                      ),
                    ];
                  })}
                  {extra && extra.values.some((v) => v !== null) && (
                    <tr className="sub">
                      <td>　{extra.label}</td>
                      {extra.values.map((v, i) => <td key={t.columns[i].key} className="num">{v === null ? "-" : `${Math.round(v)}%`}</td>)}
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {tab === "cf" && view === "Q" && <p className="muted st-note">분기 현금흐름은 보고서의 누적 값에서 앞 분기를 빼서 만들어요. 비어 있는 칸은 회사가 분기 값을 따로 내지 않은 거예요.</p>}
          </div>
          <div className="st-side">
            <Bars rows={rows} item="revenue" label="매출" tone="gold" market={market} />
            <Bars rows={rows} item="operating_income" label="영업이익" tone="up" market={market} />
          </div>
        </div>
        <div className="muted st-note">{source}</div>
      </div>
    </div>
  );
}
