import Link from "next/link";
import { notFound } from "next/navigation";
import { addPeer, deletePeer } from "@/app/actions";
import { query } from "@/lib/db";
import { loadSummaries } from "@/lib/summaryData";
import SummaryLine from "@/app/_components/SummaryLine";
import { bigMoney, debtRatio, median, operatingMargin, type FinancialRow } from "@/lib/research";

export const dynamic = "force-dynamic";

type Stock = { ticker: string; name: string; market: string; position_id: number | null };
type News = { url: string; title: string; source: string; published_at: Date; summary: string };
type Earnings = { period: string; title: string; url: string; reported_day: string | null; eps_actual: string | null; eps_estimate: string | null };
type Peer = { peer_ticker: string; peer_name: string; peer_market: string };

// 워커가 처음 돌기 전의 예전 DB에는 종목 정보 테이블이 없을 수 있습니다.
const safe = <T,>(sql: string, params: unknown[]) => query<T>(sql, params).catch(() => [] as T[]);
const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
const kst = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const [stock] = await query<Stock>(
    `SELECT s.ticker, s.name, s.market, p.id AS position_id FROM (
       SELECT ticker, name, market, 1 AS rank FROM holdings WHERE ticker = $1
       UNION ALL SELECT ticker, name, market, 2 FROM positions WHERE ticker = $1
     ) s LEFT JOIN positions p ON p.ticker = s.ticker AND p.status = 'open'
     ORDER BY s.rank LIMIT 1`,
    [ticker],
  );
  if (!stock) notFound();

  const news = await safe<News>("SELECT url, title, source, published_at, summary FROM stock_news WHERE ticker = $1 ORDER BY published_at DESC LIMIT 15", [ticker]);
  const earnings = await safe<Earnings>(
    `SELECT period, title, url, to_char(reported_on, 'YYYY-MM-DD') AS reported_day, eps_actual, eps_estimate
     FROM stock_earnings WHERE ticker = $1 ORDER BY reported_on DESC NULLS LAST, period DESC LIMIT 8`,
    [ticker],
  );
  const financials = await safe<FinancialRow>("SELECT * FROM stock_financials WHERE ticker = $1 ORDER BY period DESC", [ticker]);
  const peers = await safe<Peer>("SELECT peer_ticker, peer_name, peer_market FROM stock_peers WHERE ticker = $1 ORDER BY peer_name", [ticker]);
  const peerLatest = await safe<FinancialRow>(
    `SELECT DISTINCT ON (ticker) * FROM stock_financials WHERE ticker = ANY($1) ORDER BY ticker, period DESC`,
    [peers.map((p) => p.peer_ticker)],
  );
  const summary = (await loadSummaries([ticker])).get(ticker);
  const peerMargin = median(peerLatest.map(operatingMargin));
  const latestMargin = financials[0] ? operatingMargin(financials[0]) : null;

  return (
    <>
      <h1>{stock.name} <span className="muted">{stock.ticker} · {stock.market}</span></h1>
      <SummaryLine parts={summary} />
      {stock.position_id && <p><Link href={`/journal/${stock.position_id}`}>매매일지 보기</Link></p>}

      <h2>재무 요약</h2>
      {financials.length === 0 ? (
        <p className="muted">아직 재무 정보가 없습니다. {stock.market === "KR" ? "DART_API_KEY" : "SEC_CONTACT_EMAIL"}를 넣으면 워커가 가져옵니다.</p>
      ) : (
        <>
          {latestMargin !== null && peerMargin !== null && (
            <div className="card">
              최근 영업이익률 <strong>{latestMargin}%</strong> · 비교 기업 중앙값 <strong>{peerMargin}%</strong>{" "}
              <span className={latestMargin >= peerMargin ? "up" : "down"}>
                ({latestMargin >= peerMargin ? "+" : ""}{Math.round((latestMargin - peerMargin) * 10) / 10}%p)
              </span>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>연도</th><th className="num">매출</th><th className="num">영업이익률</th><th className="num">부채비율</th><th className="num">영업현금흐름</th></tr></thead>
              <tbody>
                {financials.map((f) => (
                  <tr key={f.period}>
                    <td>{f.period}</td>
                    <td className="num">{bigMoney(f.revenue, stock.market)}</td>
                    <td className="num">{pct(operatingMargin(f))}</td>
                    <td className="num">{pct(debtRatio(f))}</td>
                    <td className="num">{bigMoney(f.operating_cash_flow, stock.market)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>업종 비교 기업</h2>
      <p className="muted">같은 업종 회사를 몇 곳 넣으면, 그 회사들의 영업이익률 중앙값과 비교해 보여 줍니다. 재무는 다음 수집 때(최대 12시간) 채워집니다.</p>
      {peers.map((p) => {
        const f = peerLatest.find((x) => x.ticker === p.peer_ticker);
        return (
          <form key={p.peer_ticker} action={deletePeer} className="muted">
            <input type="hidden" name="ticker" value={ticker} />
            <input type="hidden" name="peerTicker" value={p.peer_ticker} />
            {p.peer_name} ({p.peer_ticker}) · 영업이익률 {f ? pct(operatingMargin(f)) : "수집 전"}{" "}
            <button type="submit" className="ghost">삭제</button>
          </form>
        );
      })}
      <form action={addPeer} className="row">
        <input type="hidden" name="ticker" value={ticker} />
        <input name="peerTicker" placeholder={stock.market === "US" ? "티커 (예: MSFT)" : "종목코드 (예: 000660)"} required />
        <input name="peerName" placeholder="회사 이름" />
        <select name="peerMarket" defaultValue={stock.market}>
          <option value="KR">국내</option>
          <option value="US">미국</option>
        </select>
        <button type="submit">추가</button>
      </form>

      <h2>최근 실적</h2>
      {earnings.length === 0 && <p className="muted">아직 없습니다. {stock.market === "KR" ? "DART_API_KEY" : "FINNHUB_API_KEY"}를 넣으면 워커가 가져옵니다.</p>}
      {earnings.map((e) => (
        <div key={e.url + e.title} className="card">
          <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a>
          <div className="muted">
            {e.reported_day ?? e.period}
            {e.eps_actual !== null && (
              <> · EPS {Number(e.eps_actual)}{e.eps_estimate !== null && (
                <> (예상 {Number(e.eps_estimate)}, <span className={Number(e.eps_actual) >= Number(e.eps_estimate) ? "up" : "down"}>
                  {Number(e.eps_actual) >= Number(e.eps_estimate) ? "상회" : "하회"}</span>)</>
              )}</>
            )}
          </div>
        </div>
      ))}

      <h2>뉴스</h2>
      {news.length === 0 && (
        <p className="muted">
          아직 없습니다. {stock.market === "KR" ? "워커가 1시간마다 구글 뉴스에서 가져옵니다." : "FINNHUB_API_KEY를 넣으면 워커가 1시간마다 가져옵니다."}
        </p>
      )}
      {news.map((n) => (
        <div key={n.url} className="card">
          <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
          <div className="muted">{n.source} · {kst(n.published_at)}</div>
          {n.summary && <div className="muted">{n.summary}</div>}
        </div>
      ))}
    </>
  );
}
