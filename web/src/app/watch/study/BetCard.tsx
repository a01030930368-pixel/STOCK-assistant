"use client";
// 기업 공부 › 가설 탭 위: 🎯 다음 실적 내 예측 + 📊 내 예측 성적 + 이 회사 지난 예측
import Link from "next/link";
import { useState } from "react";
import { deleteBet, saveBet } from "@/app/actions";
import {
  actualLine, amountText, betLine, listOrder, DIR_WORD, PX_WORD, pct, periodWord, resultMarks, short, UNIT,
  type Bet, type Dir, type PxDir, type Stats,
} from "@/lib/bets";

export type BetData = {
  period: string; current: Bet | null; est: { rev: number | null; op: number | null; asOf: string } | null; day: string | null;
  past: Bet[]; all: Bet[]; stats: Stats; companies: number;
};

const DIRS: Dir[] = ["up", "same", "down"];
const PXS: PxDir[] = ["up", "down"];
const fullDot = (d: string) => d.replaceAll("-", ".");
const dday = (day: string, today: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

function initial(ticker: string, d: BetData, market: "KR" | "US"): Record<string, string> {
  const b = d.current;
  return {
    ticker, period: d.period, revDir: b?.revDir ?? "", revValue: amountText(b?.revValue ?? null, market), opDir: b?.opDir ?? "",
    opValue: amountText(b?.opValue ?? null, market), pxDir: b?.pxDir ?? "", pxPct: b?.pxPct === null || b?.pxPct === undefined ? "" : String(Math.abs(b.pxPct)),
    confidence: String(b?.confidence ?? 60), reason: b?.reason ?? "",
  };
}

export default function BetCard({ ticker, market, data, today, onSaved }: { ticker: string; market: "KR" | "US"; data: BetData; today: string; onSaved: () => void }) {
  const [v, setV] = useState(() => initial(ticker, data, market));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (k: string, val: string) => { setV((x) => ({ ...x, [k]: val })); setSaved(false); };
  const unit = UNIT[market].word;
  const left = data.day ? dday(data.day, today) : null;
  const s = data.stats;

  const seg = <T extends string>(key: string, items: T[], word: Record<T, string>, prefix = "") => (
    <div className="segment bet-seg" role="radiogroup">
      {items.map((x) => (
        <button key={x} type="button" aria-selected={v[key] === x} className={key === "pxDir" ? `px-${x}` : ""} onClick={() => set(key, v[key] === x ? "" : x)}>
          {x === "up" && prefix ? `${prefix}${word[x]}` : word[x]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="bet-wrap">
      <form className="panel bet-card" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await saveBet(v);
        setBusy(false);
        if (r.error) setError(r.error); else { setError(""); setSaved(true); onSaved(); }
      }}>
        <div className="bet-head">
          <b>🎯 {periodWord(data.period)} 실적, 내 예측</b>
          <span className="muted">{data.day ? <>발표 {fullDot(data.day)}{left !== null && left >= 0 && <span className="th-pill g">D-{left}</span>}</> : "발표 전까지 고칠 수 있어요"}</span>
        </div>
        <p className="muted bet-cons">
          {data.est && (data.est.rev !== null || data.est.op !== null) ? (
            <>시장 예상 · 매출 <b>{short(data.est.rev, market)}</b> · 영업이익 <b>{short(data.est.op, market)}</b> <span className="th-small">({fullDot(data.est.asOf)} 기준)</span></>
          ) : "아직 시장 예상치가 없어요. 숫자를 적어 두면 그 숫자로 채점해요."}
        </p>
        <div className="bet-row"><span className="bet-l">매출</span>{seg("revDir", DIRS, DIR_WORD, "예상보다 ")}
          <input className="bet-num" inputMode="decimal" value={v.revValue} placeholder={unit} aria-label={`매출 (${unit})`} onChange={(e) => set("revValue", e.target.value)} />
        </div>
        <div className="bet-row"><span className="bet-l">영업이익</span>{seg("opDir", DIRS, DIR_WORD, "예상보다 ")}
          <input className="bet-num" inputMode="decimal" value={v.opValue} placeholder={unit} aria-label={`영업이익 (${unit})`} onChange={(e) => set("opValue", e.target.value)} />
        </div>
        <div className="bet-row"><span className="bet-l">다음 날 주가</span>{seg("pxDir", PXS, PX_WORD)}
          <input className="bet-num short" inputMode="decimal" value={v.pxPct} placeholder="%" aria-label="다음 날 주가 (%)" onChange={(e) => set("pxPct", e.target.value)} />
          <span className="muted th-small">좋게 나와도 이미 많이 올랐으면 빠질 수 있어요</span>
        </div>
        <div className="bet-row"><span className="bet-l">확신</span>
          <input type="range" min={50} max={90} step={5} value={v.confidence} onChange={(e) => set("confidence", e.target.value)} aria-label="확신" />
          <b>{v.confidence}%</b><span className="muted th-small">50% = 동전 던지기</span>
        </div>
        <div className="bet-row"><span className="bet-l">한 줄 이유</span>
          <input className="bet-reason" maxLength={200} value={v.reason} placeholder="예: HBM 물량은 늘지만 D램 값 상승이 둔해져서 이익은 예상 수준일 것 같다" onChange={(e) => set("reason", e.target.value)} />
        </div>
        {error && <p className="th-no">{error}</p>}
        <div className="th-row">
          <button type="submit" disabled={busy}>{busy ? "저장 중…" : data.current ? "고친 대로 저장" : "예측 저장"}</button>
          {data.current && <button type="button" className="secondary" onClick={async () => { if (confirm("이 예측을 지울까요?")) { await deleteBet(ticker, data.period); setV(initial(ticker, { ...data, current: null }, market)); onSaved(); } }}>지우기</button>}
          <span className="muted th-small">{saved ? "저장했어요. " : ""}🔔 발표 3일 전·채점 뒤 텔레그램으로 알려요 · 숫자는 {unit}</span>
        </div>
      </form>

      <div className="bet-side">
        <section className="panel bet-score">
          <div className="bet-head"><b>📊 내 예측 성적</b><span className="muted">모든 회사 · {s.scored}번{data.companies > 1 ? ` · ${data.companies}곳` : ""}</span></div>
          {s.scored === 0 ? <p className="muted">채점된 예측이 아직 없어요. 실적이 나오면 앱이 시장 예상과 비교해 채점해요.</p> : (
            <>
              <div className="th-sum bet-sum">
                <div><b>{pct(s.dirHits, s.dirTotal)}</b>방향 맞힘 <span className="muted">{s.dirTotal}문제 중 {s.dirHits}</span></div>
                <div><b>{pct(s.confHits, s.confTotal)}</b>확신 80%+ 일 때 <span className="muted">{s.confTotal}문제</span></div>
                <div><b>{s.pxHits} / {s.pxTotal}</b>주가 방향</div>
              </div>
              {s.habits.map((h) => <p key={h} className="bet-habit">버릇: {h}</p>)}
            </>
          )}
        </section>
        <section className="panel bet-list">
          <div className="bet-head"><b>📝 내가 적은 예측</b><span className="muted">모든 회사 · {data.all.length}개</span></div>
          {data.all.length === 0 ? <p className="muted">아직 저장한 예측이 없어요. 위에서 적고 저장하면 여기에 모여요.</p> : (
            <ul className="bet-list-rows">{listOrder(data.all).map((b) => {
              const done = Boolean(b.result && b.result.total);
              const here = b.ticker === ticker && b.period === data.period;
              return (
                <li key={`${b.ticker}:${b.period}`} className={here ? "on" : ""}>
                  <div className="bet-list-top">
                    <Link href={`/watch/study?t=${encodeURIComponent(b.ticker)}&tab=thesis`}><b>{b.name}</b></Link>
                    <span className="muted">{periodWord(b.period)}</span>
                    <span className={done ? "bet-done" : "bet-wait"}>{done ? `${b.result!.hits}/${b.result!.total} 맞힘` : "채점 기다리는 중"}</span>
                  </div>
                  <div className="bet-list-line">{betLine(b)}{done && <span className="muted"> · {actualLine(b.result)}</span>}</div>
                  {b.reason && <div className="muted bet-list-why">“{b.reason}”</div>}
                  <div className="muted th-small">적은 날 {fullDot(b.updated)}</div>
                </li>
              );
            })}</ul>
          )}
        </section>
        {data.past.length > 0 && (
          <section className="panel bet-past">
            <span className="th-k">이 회사 지난 예측</span>
            <table className="th-hist-table">
              <thead><tr><th>분기</th><th>내 예측</th><th>실제 (예상 대비)</th><th></th></tr></thead>
              <tbody>{data.past.map((b) => (
                <tr key={b.period} title={b.reason}>
                  <th>{b.period.slice(2).replace("Q", ".")}Q</th><td>{betLine(b)}</td><td>{actualLine(b.result)}</td>
                  <td className="bet-marks">{resultMarks(b.result).map((m) => <span key={m.label} className={m.ok ? "th-ok" : m.ok === false ? "th-no" : "muted"} title={m.label}>{m.ok ? "✓" : m.ok === false ? "✗" : "·"}</span>)}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
