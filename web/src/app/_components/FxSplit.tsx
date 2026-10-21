import Link from "next/link";
import { won } from "@/lib/format";
import type { FxRow } from "@/lib/fxsplit";

// 해외 탭 맨 위: 미국 주식 원화 수익을 주가 몫과 환율 몫으로 나눠 보여 줍니다.
const man = (v: number) => {
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  return a >= 10_000 ? `${s}${won(Math.round(a / 1_000) / 10, 1)}만` : `${s}${won(Math.round(a))}`;
};
const cls = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");

export default function FxSplit({ rows, price, fx, buyRate, now, unknown, empty }: {
  rows: FxRow[]; price: number; fx: number; buyRate: number | null; now: number; unknown: boolean; empty: string | null;
}) {
  const total = price + fx;
  const sum = Math.abs(price) + Math.abs(fx) || 1;
  return (
    <div className="panel fxsplit">
      <div className="panel-title">미국 주식 수익 쪼개 보기</div>
      {empty ? <div className="muted">{empty}</div> : (
        <>
          <div className="fx-top">
            <div><div className="label">원화 손익</div><div className={`fx-big num ${cls(total)}`}>{man(total)}원</div></div>
            <div><div className="label">주가로</div><div className={`fx-mid num ${cls(price)}`}>{man(price)}</div></div>
            <div><div className="label">환율로</div><div className="fx-mid num fx-c">{man(fx)}</div></div>
            {buyRate !== null && <div className="fx-rate muted">산 때 평균 환율 {won(Math.round(buyRate))}원<br />지금 {won(Math.round(now))}원</div>}
          </div>
          <div className="fx-bar" role="img" aria-label={`주가로 ${man(price)}원, 환율로 ${man(fx)}원`}>
            <i className={price >= 0 ? "fx-up" : "fx-down"} style={{ width: `${(Math.abs(price) / sum) * 100}%` }} />
            <i className="fx-fx" style={{ width: `${(Math.abs(fx) / sum) * 100}%` }} />
          </div>
          <div className="muted fx-legend"><span className={`fx-dot ${price >= 0 ? "fx-up" : "fx-down"}`} /> 주가로 {price >= 0 ? "번" : "잃은"} 돈 · <span className="fx-dot fx-fx" /> 환율로 번 돈</div>
          <div className="table-wrap fx-wide">
            <table className="fx-table">
              <thead><tr><th>종목</th><th className="num">수익률(달러)</th><th className="num">산 때 환율</th><th className="num">주가로</th><th className="num">환율로</th><th className="num">합계</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ticker}>
                    <td><Link href={`/stock/${encodeURIComponent(r.ticker)}`}><b>{r.ticker}</b></Link> <span className="muted">{r.name}</span></td>
                    <td className={`num ${cls(r.cur - r.avg)}`}>{r.avg > 0 ? `${r.cur >= r.avg ? "+" : ""}${((r.cur / r.avg - 1) * 100).toFixed(1)}%` : "-"}</td>
                    <td className="num">{r.buyRate === null ? "-" : `${won(Math.round(r.buyRate))}원${r.unknown > 0 ? "*" : ""}`}</td>
                    <td className={`num ${cls(r.price)}`}>{man(r.price)}</td>
                    <td className="num fx-c">{man(r.fx)}</td>
                    <td className={`num ${cls(r.total)}`}><b>{man(r.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="fx-list">
            {rows.map((r) => (
              <li key={r.ticker}>
                <div>
                  <Link href={`/stock/${encodeURIComponent(r.ticker)}`}><b>{r.ticker}</b></Link> <span className="muted">{r.name}</span>
                  <div className="muted">주가로 <span className={cls(r.price)}>{man(r.price)}</span> · 환율로 <span className="fx-c">{man(r.fx)}</span>{r.buyRate !== null && <> · 산 때 {won(Math.round(r.buyRate))}원{r.unknown > 0 ? "*" : ""}</>}</div>
                </div>
                <b className={`num ${cls(r.total)}`}>{man(r.total)}</b>
              </li>
            ))}
          </ul>
          <div className="muted fx-note">
            산 때 환율은 체결 기록이 있는 날의 한국은행 원/달러 기준 환율이에요. 먼저 산 주식부터 판 것으로 셈해요.
            {unknown && " *표는 체결 기록보다 오래된 주식이 있어서, 그만큼은 처음 기록된 날 환율로 셈했어요."}
          </div>
        </>
      )}
    </div>
  );
}
