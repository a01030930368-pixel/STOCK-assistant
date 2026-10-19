import Link from "next/link";
import { query } from "@/lib/db";
import { signClass, usd, won } from "@/lib/format";

export const dynamic = "force-dynamic";

type Holding = {
  ticker: string; name: string; market: "KR" | "US"; quantity: string; avg_price: string; cur_price: string;
  eval_amount: string; pnl: string; pnl_pct: string; synced_at: Date; position_id: number | null;
};
type Summary = { total_buy: string; total_eval: string; total_pnl: string; total_pnl_pct: string; est_deposit: string; synced_at: Date };
type UsSummary = { total_buy: string; total_eval: string; total_pnl: string; total_pnl_pct: string; exch_rate: string; synced_at: Date };

function syncedAt(date: Date): string {
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function HoldingsTable({ holdings, price }: { holdings: Holding[]; price: (v: string) => string }) {
  if (holdings.length === 0) return <p className="muted">보유 종목이 없습니다.</p>;
  return (
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
              <td className="num">{price(h.avg_price)}</td>
              <td className="num">{price(h.cur_price)}</td>
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
  );
}

export default async function PortfolioPage() {
  const [summary] = await query<Summary>("SELECT * FROM account_summary WHERE id = 1");
  // 예전 DB에는 워커가 처음 돌기 전까지 이 테이블이 없을 수 있습니다.
  const [usSummary] = await query<UsSummary>("SELECT * FROM us_account_summary WHERE id = 1").catch(() => []);
  const holdings = await query<Holding>(
    `SELECT h.*, p.id AS position_id FROM holdings h
     LEFT JOIN positions p ON p.ticker = h.ticker AND p.status = 'open'
     ORDER BY h.eval_amount DESC`,
  );
  const rate = usSummary ? Number(usSummary.exch_rate) : 0;

  return (
    <>
      <h1>내 포트폴리오</h1>

      <h2>국내 주식</h2>
      {summary ? (
        <div className="card">
          <div className="row">
            <div><div className="muted">평가금액</div><strong>{won(summary.total_eval)}원</strong></div>
            <div><div className="muted">평가손익</div><strong className={signClass(summary.total_pnl)}>{won(summary.total_pnl)}원 ({summary.total_pnl_pct}%)</strong></div>
            <div><div className="muted">추정예탁자산</div><strong>{won(summary.est_deposit)}원</strong></div>
          </div>
          <div className="muted">마지막 동기화 {syncedAt(summary.synced_at)}</div>
        </div>
      ) : (
        <p className="card muted">아직 키움 잔고를 불러오지 않았습니다. .env에 키움 앱키를 넣고 워커를 실행하세요.</p>
      )}
      <HoldingsTable holdings={holdings.filter((h) => h.market === "KR")} price={(v) => won(v, 2)} />

      <h2>미국 주식</h2>
      {usSummary ? (
        <div className="card">
          <div className="row">
            <div>
              <div className="muted">평가금액</div>
              <strong>{usd(usSummary.total_eval)}</strong>
              {rate > 0 && <div className="muted">약 {won(Number(usSummary.total_eval) * rate)}원</div>}
            </div>
            <div><div className="muted">평가손익</div><strong className={signClass(usSummary.total_pnl)}>{usd(usSummary.total_pnl)} ({usSummary.total_pnl_pct}%)</strong></div>
            <div><div className="muted">환율</div><strong>{rate > 0 ? `${won(rate, 2)}원` : "-"}</strong></div>
          </div>
          <div className="muted">마지막 동기화 {syncedAt(usSummary.synced_at)}</div>
        </div>
      ) : (
        <p className="card muted">아직 미국 잔고를 불러오지 않았습니다. 워커가 시작할 때와 미국 장중에 불러옵니다.</p>
      )}
      <HoldingsTable holdings={holdings.filter((h) => h.market === "US")} price={usd} />
    </>
  );
}
