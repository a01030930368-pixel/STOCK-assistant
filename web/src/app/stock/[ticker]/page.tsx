import Link from "next/link";
import { notFound } from "next/navigation";
import { addPeer, addWatch, deletePeer, removeWatch, startStudy } from "@/app/actions";
import { query } from "@/lib/db";
import { loadSummaries } from "@/lib/summaryData";
import SummaryLine from "@/app/_components/SummaryLine";
import AiNote, { type AiComment } from "@/app/_components/AiNote";
import StockNews from "@/app/_components/StockNews";
import ChartMemo, { type Candle, type Doodle, type Level, type Mark, type Memo, type MinuteCandle, type Shape, type Trade } from "@/app/_components/ChartMemo";
import { wallClock } from "@/lib/candles";
import { dartUrl, kindOf } from "@/lib/disclosures";
import Statements from "@/app/_components/Statements";
import EarningsReport from "@/app/_components/EarningsReport";
import FlowChart, { type StockTheme } from "@/app/_components/FlowChart";
import type { FlowRow } from "@/lib/flows";
import type { Report } from "@/lib/earnings";
import type { StatementRow } from "@/lib/statements";
import BriefPanel, { type Brief } from "./BriefPanel";
import { bigMoney, debtRatio, median, operatingMargin, type FinancialRow } from "@/lib/research";

export const dynamic = "force-dynamic";

type Stock = { ticker: string; name: string; market: string; position_id: number | null; watched: boolean; cur: string | null };
type News = { url: string; title: string; title_ko: string | null; source: string; published_at: Date; summary: string; summary_ko: string | null };
type Earnings = { period: string; title: string; url: string; reported_day: string | null; eps_actual: string | null; eps_estimate: string | null };
type Filing = { rcept_no: string; title: string; kind: string; important: boolean; day: string; seen_at: Date; summary: string | null };
type Peer = { peer_ticker: string; peer_name: string; peer_market: string };

// 워커가 처음 돌기 전의 예전 DB에는 종목 정보 테이블이 없을 수 있습니다.
const safe = <T,>(sql: string, params: unknown[]) => query<T>(sql, params).catch(() => [] as T[]);
const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
const kst = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// DART 목록에는 시각이 없어, 접수한 날에 워커가 본 시각만 보여 줘요(처음 채운 옛 공시는 날짜만).
const seenTime = (d: Date) => d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const seenSameDay = (f: { day: string; seen_at: Date }) => f.seen_at.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) === f.day;

export default async function StockPage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ brief?: string }> }) {
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const showBrief = (await searchParams).brief === "1";
  const [found] = await query<Stock>(
    `SELECT s.ticker, s.name, s.market, p.id AS position_id,
       EXISTS (SELECT 1 FROM watchlist w WHERE w.ticker = s.ticker) AS watched,
       COALESCE((SELECT cur_price FROM holdings WHERE ticker = s.ticker), (SELECT price FROM watch_quotes WHERE ticker = s.ticker),
                (SELECT close FROM price_history WHERE ticker = s.ticker ORDER BY day DESC LIMIT 1)) AS cur
     FROM (
       SELECT ticker, name, market, 1 AS rank FROM holdings WHERE ticker = $1
       UNION ALL SELECT ticker, name, market, 2 FROM positions WHERE ticker = $1
       UNION ALL SELECT ticker, name, market, 3 FROM watchlist WHERE ticker = $1
     ) s LEFT JOIN positions p ON p.ticker = s.ticker AND p.status = 'open'
     ORDER BY s.rank LIMIT 1`,
    [ticker],
  ).catch(() => query<Stock>(
    // 관심종목 테이블이 생기기 전(워커 업데이트 전) DB
    `SELECT s.ticker, s.name, s.market, p.id AS position_id, false AS watched, NULL AS cur FROM (
       SELECT ticker, name, market, 1 AS rank FROM holdings WHERE ticker = $1
       UNION ALL SELECT ticker, name, market, 2 FROM positions WHERE ticker = $1
     ) s LEFT JOIN positions p ON p.ticker = s.ticker AND p.status = 'open'
     ORDER BY s.rank LIMIT 1`,
    [ticker],
  ));
  // ISA 계좌에만 있는 종목(예: 적립식 ETF)
  const [isaStock] = found ? [] : await query<Stock>(
    `SELECT ticker, name, 'KR' AS market, NULL::int AS position_id,
       EXISTS (SELECT 1 FROM watchlist w WHERE w.ticker = i.ticker) AS watched, cur_price AS cur
     FROM isa_holdings i WHERE ticker = $1`,
    [ticker],
  ).catch(() => []);
  const stock = found ?? isaStock;
  if (!stock) notFound();

  const news = await safe<News>(
    "SELECT url, title, title_ko, source, published_at, summary, summary_ko FROM stock_news WHERE ticker = $1 ORDER BY published_at DESC LIMIT 15",
    [ticker],
  ).then((rows) => rows.length ? rows : safe<News>(
    // 워커 업데이트 전 DB에는 summary_ko가 없어요.
    "SELECT url, title, NULL AS title_ko, source, published_at, summary, NULL AS summary_ko FROM stock_news WHERE ticker = $1 ORDER BY published_at DESC LIMIT 15",
    [ticker],
  ));
  const earnings = await safe<Earnings>(
    `SELECT period, title, url, to_char(reported_on, 'YYYY-MM-DD') AS reported_day, eps_actual, eps_estimate
     FROM stock_earnings WHERE ticker = $1 ORDER BY reported_on DESC NULLS LAST, period DESC LIMIT 8`,
    [ticker],
  );
  // 실적 정리(표·막대·해설)는 워커 업데이트 뒤에 생기고, 다음 실적 발표부터 채워져요.
  const [report] = await safe<Report>(
    `SELECT period, to_char(reported_on, 'YYYY-MM-DD') AS reported_on, url, market, data, ai
     FROM earnings_reports WHERE ticker = $1 ORDER BY reported_on DESC, created_at DESC LIMIT 1`,
    [ticker],
  );
  // 공시 표는 워커 업데이트 뒤에 생겨요.
  const filingSql = (summary: string) => `SELECT rcept_no, title, kind, important, to_char(day, 'YYYY-MM-DD') AS day, seen_at, ${summary} AS summary
     FROM stock_disclosures WHERE ticker = $1 ORDER BY day DESC, rcept_no DESC LIMIT 20`;
  const filings = stock.market === "KR"
    // 요약 칸은 워커 업데이트 뒤에 생겨요.
    ? await query<Filing>(filingSql("summary"), [ticker]).catch(() => safe<Filing>(filingSql("NULL"), [ticker]))
    : [];
  // 재무제표(연간·분기) 표는 워커 업데이트 뒤에 생기고, 처음 채워지기까지 최대 12시간 걸려요.
  const statementRows = (await safe<{ kind: StatementRow["kind"]; period: string; item: string; value: string; fetched_at: Date }>(
    "SELECT kind, period, item, value, fetched_at FROM stock_statements WHERE ticker = $1",
    [ticker],
  ));
  const statements = statementRows.map<StatementRow>((r) => ({ kind: r.kind, period: r.period, item: r.item, value: Number(r.value) }));
  const statementsAt = statementRows[0]?.fetched_at;
  // PER·PBR 밴드용 주식 수(워커 업데이트 뒤에 생겨요)
  const [shareRow] = await safe<{ shares: string }>("SELECT shares FROM stock_shares WHERE ticker = $1", [ticker]);
  const shares = shareRow ? Number(shareRow.shares) : null;
  // 국내 종목만: 투자자별 수급과 이 종목이 든 테마(워커 업데이트 뒤에 생겨요)
  const flows = stock.market === "KR" ? (await safe<{ day: string; close: string; foreign_net: string; institution_net: string; individual_net: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, close, foreign_net, institution_net, individual_net FROM investor_flows WHERE ticker = $1 ORDER BY day", [ticker],
  )).map<FlowRow>((f) => ({ day: f.day, close: Number(f.close), foreign: Number(f.foreign_net), institution: Number(f.institution_net), individual: Number(f.individual_net) })) : [];
  const stockThemes = stock.market === "KR" ? (await safe<{ code: string; name: string; change_pct: string | null }>(
    "SELECT s.code, s.name, t.change_pct FROM stock_themes s LEFT JOIN theme_index t ON t.code = s.code WHERE s.ticker = $1 ORDER BY t.change_pct DESC NULLS LAST", [ticker],
  )).map<StockTheme>((t) => ({ code: t.code, name: t.name, change_pct: t.change_pct === null ? null : Number(t.change_pct) })) : [];
  const financials = await safe<FinancialRow>("SELECT * FROM stock_financials WHERE ticker = $1 ORDER BY period DESC", [ticker]);
  const peers = await safe<Peer>("SELECT peer_ticker, peer_name, peer_market FROM stock_peers WHERE ticker = $1 ORDER BY peer_name", [ticker]);
  const peerLatest = await safe<FinancialRow>(
    `SELECT DISTINCT ON (ticker) * FROM stock_financials WHERE ticker = ANY($1) ORDER BY ticker, period DESC`,
    [peers.map((p) => p.peer_ticker)],
  );
  const summary = (await loadSummaries([ticker])).get(ticker);
  const candles = (await safe<{ day: string; open: string | null; high: string | null; low: string | null; close: string; volume: string | null }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close, volume FROM price_history WHERE ticker = $1 ORDER BY day",
    [ticker],
  )).map<Candle>((p) => {
    const close = Number(p.close);
    return {
      day: p.day, close, volume: p.volume === null ? null : Number(p.volume),
      open: p.open === null ? close : Number(p.open), high: p.high === null ? close : Number(p.high), low: p.low === null ? close : Number(p.low),
    };
  });
  const [comment] = await safe<AiComment>(
    "SELECT ticker, to_char(day, 'YYYY-MM-DD') AS day, tone, body FROM ai_comments WHERE ticker = $1 ORDER BY day DESC LIMIT 1",
    [ticker],
  );
  const tz = stock.market === "US" ? "America/New_York" : "Asia/Seoul";
  const minutes = (await safe<{ ts: Date; open: string; high: string; low: string; close: string; volume: string }>(
    "SELECT ts, open, high, low, close, volume FROM minute_bars WHERE ticker = $1 ORDER BY ts",
    [ticker],
  )).map<MinuteCandle>((m) => ({
    t: wallClock(m.ts, tz), open: Number(m.open), high: Number(m.high), low: Number(m.low), close: Number(m.close), volume: Number(m.volume),
  }));
  const trades = (await safe<{ day: string; side: "buy" | "sell"; price: string; quantity: string }>(
    `SELECT to_char(b.trade_date, 'YYYY-MM-DD') AS day, 'buy' AS side, b.price, b.quantity FROM buy_entries b JOIN positions p ON p.id = b.position_id WHERE p.ticker = $1
     UNION ALL
     SELECT to_char(s.trade_date, 'YYYY-MM-DD'), 'sell', s.price, s.quantity FROM sell_entries s JOIN positions p ON p.id = s.position_id WHERE p.ticker = $1`,
    [ticker],
  )).map<Trade>((t) => ({ day: t.day, side: t.side, price: Number(t.price), quantity: Number(t.quantity) }));
  const levels = (await safe<{ kind: Level["kind"]; price: string }>(
    `SELECT 'avg' AS kind, avg_price AS price FROM holdings WHERE ticker = $1 AND avg_price > 0
     UNION ALL
     SELECT CASE WHEN kind = 'custom' THEN 'alert' ELSE kind END, price FROM alerts WHERE ticker = $1 AND active`,
    [ticker],
  )).map<Level>((l) => ({ kind: l.kind, price: Number(l.price) }));
  const marks = (await safe<{ id: number; kind: Mark["kind"]; low: string; high: string | null; memo: string; alert: boolean; color: string | null }>(
    "SELECT id, kind, low, high, memo, alert, color FROM chart_levels WHERE ticker = $1 ORDER BY id", [ticker],
  ).then((rows) => rows.length ? rows : safe<{ id: number; kind: Mark["kind"]; low: string; high: string | null; memo: string; alert: boolean; color: string | null }>(
    // 워커 업데이트 전 DB에는 color 칸이 없어요.
    "SELECT id, kind, low, high, memo, alert, NULL AS color FROM chart_levels WHERE ticker = $1 ORDER BY id", [ticker],
  ))).map<Mark>((m) => ({ ...m, low: Number(m.low), high: m.high === null ? null : Number(m.high) }));
  const doodles = await safe<Doodle>("SELECT id, view, color, points FROM chart_doodles WHERE ticker = $1 ORDER BY id", [ticker]);
  // 워커 업데이트 전 DB에는 chart_shapes 표가 없어요(safe가 빈 목록을 돌려줘요).
  const shapes = await safe<Shape>("SELECT id, view, kind, points, color, alert FROM chart_shapes WHERE ticker = $1 ORDER BY id", [ticker]);
  const memos = await safe<Memo>(
    "SELECT id, to_char(day, 'YYYY-MM-DD') AS day, body FROM chart_memos WHERE ticker = $1 ORDER BY day DESC, id DESC",
    [ticker],
  );
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
  // 한 장 요약 표는 워커 업데이트 뒤에 생겨요.
  const [brief] = showBrief ? await safe<Brief>(
    "SELECT cells, one_line, good, bad, pending, error, made_at FROM stock_briefs WHERE ticker = $1", [ticker],
  ) : [];
  const here = `/stock/${encodeURIComponent(ticker)}`;
  const peerMargin = median(peerLatest.map(operatingMargin));
  const latestMargin = financials[0] ? operatingMargin(financials[0]) : null;
  const [studied] = await safe<{ ticker: string }>("SELECT ticker FROM study_notes WHERE ticker = $1", [ticker]);

  return (
    <>
      <div className="page-head">
        <h1>{stock.name} <span className="muted">{stock.ticker} · {stock.market}</span></h1>
        <form action={stock.watched ? removeWatch : addWatch}>
          <input type="hidden" name="ticker" value={stock.ticker} />
          <input type="hidden" name="name" value={stock.name} />
          <input type="hidden" name="market" value={stock.market} />
          <button type="submit" className={stock.watched ? "chip-btn on" : "chip-btn"}>{stock.watched ? "★ 관심종목" : "☆ 관심종목에 추가"}</button>
          <Link href={`/compare?t=${stock.ticker}`} className="chip-btn">⇄ 비교</Link>
          <Link href={showBrief ? here : `${here}?brief=1`} scroll={false} className={showBrief ? "chip-btn on" : "chip-btn gold"}>📄 한 장 요약</Link>
          {studied ? <Link href={`/watch/study?t=${encodeURIComponent(stock.ticker)}`} className="chip-btn on">📒 공부 노트</Link>
            : <button type="submit" formAction={startStudy} className="chip-btn">📒 공부 노트 쓰기</button>}
        </form>
      </div>
      {showBrief && <BriefPanel ticker={ticker} name={stock.name} market={stock.market} brief={brief ?? null} closeHref={here}
        ai={Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)} />}
      <SummaryLine parts={summary} />
      {comment && <div className="panel ai-panel"><AiNote c={comment} title={<span className="label">AI 한마디</span>} /></div>}
      {stock.position_id && <p><Link href={`/journal/${stock.position_id}`}>매매일지 보기</Link></p>}

      <h2>차트 · 메모 · 가격 알림</h2>
      <ChartMemo ticker={ticker} name={stock.name} current={stock.cur === null ? null : Number(stock.cur)} market={stock.market} candles={candles} minutes={minutes} memos={memos} trades={trades} levels={levels} today={today} marks={marks} doodles={doodles} shapes={shapes}
        statements={statements} shares={shares} />

      {stock.market === "KR" && (
        <>
          <h2>수급 · 외국인 · 기관 · 개인</h2>
          <FlowChart rows={flows} themes={stockThemes} at={flows.length ? flows[flows.length - 1].day.slice(5).replace("-", ".") : null} />
        </>
      )}

      <h2>{statements.length > 0 ? "재무제표" : "재무 요약"}</h2>
      {statements.length > 0 ? (
        <>
          <Statements
            rows={statements}
            market={stock.market}
            source={`${stock.market === "US" ? "SEC EDGAR · 달력 기준 연도·분기" : "DART 사업·반기·분기보고서 · 연결 기준(없으면 별도)"}${statementsAt ? ` · ${kst(statementsAt)} 받음` : ""}`}
          />
          {latestMargin !== null && peerMargin !== null && (
            <div className="card">
              최근 영업이익률 <strong>{latestMargin}%</strong> · 비교 기업 중앙값 <strong>{peerMargin}%</strong>{" "}
              <span className={latestMargin >= peerMargin ? "up" : "down"}>
                ({latestMargin >= peerMargin ? "+" : ""}{Math.round((latestMargin - peerMargin) * 10) / 10}%p)
              </span>
            </div>
          )}
        </>
      ) : financials.length === 0 ? (
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

      {stock.market === "KR" && (
        <>
          <h2>공시</h2>
          {filings.length === 0 ? (
            <p className="muted">
              {process.env.DART_API_KEY ? "아직 없어요. 들고 있거나 관심종목에 넣은 종목이면 워커가 10분마다 DART에서 확인해요. ETF는 공시가 없어요." : "DART_API_KEY를 넣으면 워커가 들고 있는 종목과 관심종목의 공시를 10분마다 확인해요."}
            </p>
          ) : (
            <div className="panel">
              <div className="muted" style={{ fontSize: "0.8rem" }}>중요한 공시는 텔레그램으로 바로 알려 드려요{process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY ? " (🤖는 AI가 본문을 읽고 정리한 한 줄)" : ""}. 지분·기타 공시는 여기에만 보여요.</div>
              <ul className="disc">
                {filings.map((f) => {
                  const k = kindOf(f.kind);
                  return (
                    <li key={f.rcept_no} className={f.important ? "" : "quiet"}>
                      <div className="when">{f.day.slice(5).replace("-", ".")}{seenSameDay(f) && <><br />{seenTime(f.seen_at)}</>}</div>
                      <div className="what">
                        <span className={`badge ${k.tone}`}>{k.label}</span>
                        <a href={dartUrl(f.rcept_no)} target="_blank" rel="noopener noreferrer">{f.title}</a>
                        {f.summary ? <div className="why ai-line">🤖 {f.summary}</div> : f.important && k.explain && <div className="why">{k.explain}</div>}
                      </div>
                      <a className="muted" href={dartUrl(f.rcept_no)} target="_blank" rel="noopener noreferrer">DART ›</a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      <h2>최근 실적</h2>
      {report && <EarningsReport report={report} />}
      {!report && earnings.length === 0 && <p className="muted">아직 없습니다. {stock.market === "KR" ? "DART_API_KEY" : "FINNHUB_API_KEY"}를 넣으면 워커가 가져옵니다.</p>}
      {earnings.length > 0 && report && <h3 className="er-past">지난 실적 기록</h3>}
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

      <StockNews us={stock.market === "US"} items={news.map((n) => ({
        url: n.url, title: n.title, titleKo: n.title_ko, summary: n.summary, summaryKo: n.summary_ko, meta: `${n.source} · ${kst(n.published_at)}`,
      }))} />
      {news.length === 0 && (
        <p className="muted">
          아직 없습니다. {stock.market === "KR" ? "워커가 1시간마다 구글 뉴스에서 가져옵니다." : "워커가 1시간마다 구글 뉴스(국내 기사)와 Finnhub(FINNHUB_API_KEY가 있을 때)에서 가져옵니다."}
        </p>
      )}
    </>
  );
}
