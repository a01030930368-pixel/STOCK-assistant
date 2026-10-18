import Link from "next/link";
import { query } from "@/lib/db";
import { signClass, won } from "@/lib/format";

export const dynamic = "force-dynamic";

type Holding = {
  ticker: string; name: string; market: "KR" | "US"; quantity: string; avg_price: string; cur_price: string;
  eval_amount: string; pnl: string; pnl_pct: string; synced_at: Date; position_id: number | null;
};
type Summary = { total_buy: string; total_eval: string; total_pnl: string; total_pnl_pct: string; est_deposit: string; synced_at: Date };

export default async function PortfolioPage() {
  const [summary] = await query<Summary>("SELECT * FROM account_summary WHERE id = 1");
  const holdings = await query<Holding>(
    `SELECT h.*, p.id AS position_id FROM holdings h
     LEFT JOIN positions p ON p.ticker = h.ticker AND p.status = 'open'
     ORDER BY h.eval_amount DESC`,
  );

  return (
    <>
      <h1>내 포트폴리오</h1>
      {summary ? (
        <div className="card">
          <div className="row">
            <div><div className="muted">평가금액</div><strong>{won(summary.total_eval)}원</strong></div>
            <div><div className="muted">평가손익</div><strong className={signClass(summary.total_pnl)}>{won(summary.total_pnl)}원 ({summary.total_pnl_pct}%)</strong></div>
            <div><div className="muted">추정예탁자산</div><strong>{won(summary.est_deposit)}원</strong></div>
          </div>
          <div className="muted">마지막 동기화 {summary.synced_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</div>
        </div>
      ) : (
        <p className="card muted">아직 키움 잔고를 불러오지 않았습니다. .env에 키움 앱키를 넣고 워커를 실행하세요.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>종목</th><th className="num">수량</th><th className="num">평단</th><th className="num">현재가</th><th className="num">수익률</th><th>매매일지</th></tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.ticker}>
                <td>{h.name} <span className="muted">{h.ticker}</span></td>
                <td className="num">{won(h.quantity, 4)}</td>
                <td className="num">{won(h.avg_price, 2)}</td>
                <td className="num">{won(h.cur_price, 2)}</td>
                <td className={`num ${signClass(h.pnl_pct)}`}>{h.pnl_pct}%</td>
                <td>
                  {h.position_id ? (
                    <Link href={`/journal/${h.position_id}`}>보기</Link>
                  ) : (
                    <Link href={`/journal/buy?${new URLSearchParams({ ticker: h.ticker, name: h.name, market: h.market })}`}>작성</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
