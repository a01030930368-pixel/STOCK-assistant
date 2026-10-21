"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AskHistory from "@/app/_components/AskHistory";
import ReturnChart from "@/app/_components/ReturnChart";
import { COLORS, daysBefore, leader, MAX, PERIODS, rebase, ROWS, type Close, type Metrics, type PeriodKey } from "@/lib/compare";
import { times } from "@/lib/bands";
import { money } from "@/lib/flows";

export type Stock = {
  ticker: string; name: string; market: "KR" | "US"; closes: Close[]; price: number | null;
  metrics: Omit<Metrics, "ret">; hasFinancials: boolean;
};
type Option = { ticker: string; name: string; market: "KR" | "US" };

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
function show(key: keyof Metrics, v: number | null): string {
  if (v === null) return "-";
  switch (key) {
    case "ret": case "growth": return signed(v);
    case "per": case "pbr": return times(v);
    case "foreign20": return money(v);
    default: return `${v.toFixed(1)}%`;
  }
}
const tone = (key: keyof Metrics, v: number | null) => (v === null || !["ret", "growth", "foreign20"].includes(key) ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const priceText = (s: Stock) => (s.price === null ? "" : s.market === "US" ? `$${s.price.toFixed(2)}` : `${Math.round(s.price).toLocaleString("ko-KR")}원`);

export default function CompareView({ stocks, period, today, options, pending, error }: {
  stocks: Stock[]; period: PeriodKey; today: string; options: Option[]; pending: string[]; error: string | null;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const go = (tickers: string[], p: PeriodKey = period) =>
    router.push(tickers.length ? `/compare?t=${tickers.join(",")}&p=${p}` : `/compare?p=${p}`);
  const tickers = stocks.map((s) => s.ticker);

  const missing = stocks.filter((s) => s.closes.length < 2);

  const add = () => {
    const q = input.trim();
    if (!q) return;
    const hit = options.find((o) => o.ticker.toUpperCase() === q.toUpperCase() || o.name === q)
      ?? options.find((o) => o.name.includes(q));
    const t = (hit?.ticker ?? q).toUpperCase();
    setInput("");
    if (/^[0-9A-Z.\-]{1,12}$/.test(t) && !tickers.includes(t) && tickers.length < MAX) go([...tickers, t]);
  };

  const from = daysBefore(today, PERIODS.find((p) => p.key === period)!.days);
  const lines = rebase(stocks.map((s) => s.closes), from);
  const rets = lines.values.map((v) => [...v].reverse().find((x): x is number => x !== null) ?? null);
  const rows = ROWS.filter((r) => !r.krOnly || stocks.some((s) => s.market === "KR"));
  const value = (s: Stock, k: number, key: keyof Metrics) => (key === "ret" ? rets[k] : s.metrics[key]);
  const noFin = stocks.filter((s) => !s.hasFinancials);
  const wide = stocks.length > 2;

  return (
    <div className="compare">
      <div className="page-head"><h1>종목 비교</h1></div>
      <div className="compare-bar">
        {stocks.map((s, k) => (
          <span key={s.ticker} className="compare-pick">
            <i style={{ background: COLORS[k] }} />
            <Link href={`/stock/${s.ticker}`}>{s.name}</Link>
            <button type="button" aria-label={`${s.name} 빼기`} onClick={() => go(tickers.filter((t) => t !== s.ticker))}>✕</button>
          </span>
        ))}
        {stocks.length < MAX && (
          <form className="compare-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input list="compare-options" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={stocks.length ? "종목 더하기 (최대 4개)" : "종목 이름이나 코드 (005930, NVDA)"} aria-label="비교할 종목" />
            <datalist id="compare-options">
              {options.filter((o) => !tickers.includes(o.ticker)).map((o) => <option key={o.ticker} value={o.ticker}>{o.name}</option>)}
            </datalist>
            <button type="submit">더하기</button>
          </form>
        )}
        <div className="segment" role="tablist" aria-label="기간">
          {PERIODS.map((p) => <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => go(tickers, p.key)}>{p.label}</button>)}
        </div>
      </div>

      <AskHistory items={missing.map((s): [string, "KR" | "US"] => [s.ticker, s.market])} pending={pending} />
      {missing.length > 0 && (
        <p className="callout">{missing.map((s) => s.name).join(", ")} 일봉을 받는 중이에요. 워커가 받으면 이 화면이 저절로 새로 그려져요.{error && <><br /><span className="muted">지난번 실패: {error}</span></>}</p>
      )}

      {stocks.length === 0 ? (
        <div className="panel compare-empty">
          <p>비교할 종목을 위 칸에 넣어 보세요. 종목 페이지의 &quot;비교&quot; 버튼으로도 시작할 수 있어요.</p>
          <div className="compare-quick">
            {options.slice(0, 8).map((o) => <button key={o.ticker} type="button" onClick={() => go([o.ticker])}>{o.name}</button>)}
          </div>
        </div>
      ) : (
        <div className={`compare-grid${wide ? " wide" : ""}`}>
          <div className="panel">
            <span className="label">같은 날 같은 돈을 넣었다면 · 수익률</span>
            <ReturnChart days={lines.days} series={stocks.map((s, k) => ({ label: s.name, color: COLORS[k], values: lines.values[k] }))} />
            <p className="chart-foot">{PERIODS.find((p) => p.key === period)!.label} 전 첫 거래일을 0%로 맞춰 겹쳤어요. 국내·미국 휴장일은 앞 종가를 이어 그렸어요.</p>
          </div>
          <div className="panel compare-table">
            <span className="label">나란히 보기</span>
            <table>
              <thead>
                <tr><th />{stocks.map((s, k) => <th key={s.ticker} className="num"><i className="dot" style={{ background: COLORS[k] }} />{s.name}</th>)}</tr>
              </thead>
              <tbody>
                <tr><td className="muted">현재가</td>{stocks.map((s) => <td key={s.ticker} className="num">{priceText(s) || "-"}</td>)}</tr>
                {rows.map((r) => {
                  const vals = stocks.map((s, k) => (r.krOnly && s.market !== "KR" ? null : value(s, k, r.key)));
                  const best = leader(vals, r.better, r.key === "per" || r.key === "pbr");
                  return (
                    <tr key={r.key}>
                      <td className="muted">{r.key === "ret" ? `${PERIODS.find((p) => p.key === period)!.label} 수익률` : r.label}</td>
                      {vals.map((v, k) => (
                        <td key={k} className="num"><span className={tone(r.key, v)}>{show(r.key, v)}</span>{best === k && <span className="lead">앞섬</span>}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="chart-foot">
              PER·PBR은 최근 실적과 지금 주가로, 매출 성장·영업이익률·부채비율은 가장 최근 1년 재무로 계산했어요.
              {noFin.length > 0 && ` ${noFin.map((s) => s.name).join(", ")}은(는) 재무를 아직 안 받아서 비어 있어요. 관심종목에 넣으면 받아 와요.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
