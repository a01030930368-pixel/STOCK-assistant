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

function Holdings({ holdings, price }: { holdings: Holding[]; price: (v: string) => string }) {
  return (
    <div className="list">
      {holdings.length === 0 && <div className="list-empty">보유 종목이 없습니다.</div>}
      {holdings.map((h) => (
        <div className="list-item" key={h.ticker}>
          <div className="main">
            <Link className="title" href={`/stock/${encodeURIComponent(h.ticker)}`}>{h.name}</Link>{" "}
            <span className="chip">{h.ticker}</span>
            <div className="sub">
              {won(h.quantity, 4)}주 · 평단 {price(h.avg_price)} · 현재 {price(h.cur_price)} ·{" "}
              {h.position_id ? (
                <Link href={`/journal/${h.position_id}`}>매매일지</Link>
              ) : (
                <Link href={`/journal/buy?${new URLSearchParams({ ticker: h.ticker, name: h.name, market: h.market })}`}>일지 작성</Link>
              )}
            </div>
          </div>
          <div className="side">
            <span className="num">{price(h.eval_amount)}</span>
            <span className={`badge ${signClass(h.pnl_pct)}`}>{signed(h.pnl_pct)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const signed = (v: string | number) => (Number(v) > 0 ? `+${v}` : `${v}`);

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
  const kr = holdings.filter((h) => h.market === "KR");
  const us = holdings.filter((h) => h.market === "US");

  return (
    <>
      <div className="page-head">
        <h1>내 포트폴리오</h1>
        {summary && <span className="muted">마지막 동기화 {syncedAt(summary.synced_at)}</span>}
      </div>

      <div className="section-head"><h2>국내 주식</h2><span className="muted">{kr.length}종목</span></div>
      {summary ? (
        <div className="stats">
          <div className="stat hero"><div className="stat-label">평가금액</div><div className="stat-value">{won(summary.total_eval)}원</div></div>
          <div className="stat">
            <div className="stat-label">평가손익</div>
            <div className={`stat-value ${signClass(summary.total_pnl)}`}>{signed(won(summary.total_pnl))}원</div>
            <div className="stat-sub"><span className={`badge ${signClass(summary.total_pnl_pct)}`}>{signed(summary.total_pnl_pct)}%</span></div>
          </div>
          <div className="stat"><div className="stat-label">추정예탁자산</div><div className="stat-value">{won(summary.est_deposit)}원</div></div>
        </div>
      ) : (
        <p className="card muted">아직 키움 잔고를 불러오지 않았습니다. .env에 키움 앱키를 넣고 워커를 실행하세요.</p>
      )}
      <Holdings holdings={kr} price={(v) => `${won(v, 2)}원`} />

      <div className="section-head"><h2>미국 주식</h2><span className="muted">{us.length}종목</span></div>
      {usSummary ? (
        <div className="stats">
          <div className="stat hero">
            <div className="stat-label">평가금액</div>
            <div className="stat-value">{usd(usSummary.total_eval)}</div>
            {rate > 0 && <div className="stat-sub">약 {won(Number(usSummary.total_eval) * rate)}원</div>}
          </div>
          <div className="stat">
            <div className="stat-label">평가손익</div>
            <div className={`stat-value ${signClass(usSummary.total_pnl)}`}>{Number(usSummary.total_pnl) > 0 ? "+" : ""}{usd(usSummary.total_pnl)}</div>
            <div className="stat-sub"><span className={`badge ${signClass(usSummary.total_pnl_pct)}`}>{signed(usSummary.total_pnl_pct)}%</span></div>
          </div>
          <div className="stat">
            <div className="stat-label">적용 환율</div>
            <div className="stat-value">{rate > 0 ? `${won(rate, 2)}원` : "-"}</div>
            <div className="stat-sub">동기화 {syncedAt(usSummary.synced_at)}</div>
          </div>
        </div>
      ) : (
        <p className="card muted">아직 미국 잔고를 불러오지 않았습니다. 워커가 시작할 때와 미국 장중에 불러옵니다.</p>
      )}
      <Holdings holdings={us} price={usd} />
    </>
  );
}
