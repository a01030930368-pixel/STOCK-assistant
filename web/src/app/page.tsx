import Link from "next/link";
import { distancePct, scopeOf, totalOf, type Account, type Scope } from "@/lib/board";
import { query } from "@/lib/db";
import { asOf, fixedPct, signClass, usd, won } from "@/lib/format";
import NewsTabs from "./_components/NewsTabs";
import SummaryLine from "./_components/SummaryLine";
import { loadSummaries } from "@/lib/summaryData";
import type { Part } from "@/lib/summary";
import AiNote, { type AiComment } from "@/app/_components/AiNote";
import EventLine, { type CalendarEvent } from "./_components/EventLine";

export const dynamic = "force-dynamic";

type Holding = {
  ticker: string; name: string; market: "KR" | "US"; quantity: string; avg_price: string; cur_price: string;
  eval_amount: string; pnl: string; pnl_pct: string; position_id: number | null;
};
type Summary = { total_buy: string; total_eval: string; total_pnl: string; total_pnl_pct: string; synced_at: Date };
type UsSummary = Summary & { exch_rate: string };
type Cash = { market: "KR" | "US"; deposit: string; d2_deposit: string | null; orderable: string | null; synced_at: Date };
type AlertRow = { ticker: string; name: string; market: "KR" | "US"; kind: "stop" | "target" | "custom"; direction: "below" | "above"; price: string; cur_price: string };
type News = { ticker: string; market: "KR" | "US"; url: string; title: string; title_ko: string | null; source: string; published_at: Date };
type Filing = { ticker: string; name: string; title: string; url: string; reported_day: string };

const signed = (v: number, text: string) => (v > 0 ? `+${text}` : text);
const krw = (v: number | string) => `${won(v)}원`;
const money = (market: "KR" | "US") => (market === "KR" ? (v: string | number) => `${won(v, 2)}원` : usd);
const kst = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function account(s: Summary | undefined, cash: Cash | undefined): Account | null {
  if (!s) return null;
  const left = cash ? Number(cash.d2_deposit ?? cash.deposit) : null;
  return { eval: Number(s.total_eval), buy: Number(s.total_buy), pnl: Number(s.total_pnl), cash: left };
}

function HoldingRows({ rows, summaries }: { rows: Holding[]; summaries: Map<string, Part[]> }) {
  return (
    <div className="list">
      {rows.map((h) => {
        const price = money(h.market);
        return (
          <div className="list-item" key={h.ticker}>
            <div className="main">
              <Link className="title" href={`/stock/${encodeURIComponent(h.ticker)}`}>{h.name}</Link>
              <div className="sub">
                <span className="num">{h.ticker} · {won(h.quantity, 4)}주</span> ·{" "}
                {h.position_id ? (
                  <Link href={`/journal/${h.position_id}`}>매매일지</Link>
                ) : (
                  <Link href={`/journal/buy?${new URLSearchParams({ ticker: h.ticker, name: h.name, market: h.market })}`}>일지 작성</Link>
                )}
              </div>
              <SummaryLine parts={summaries.get(h.ticker)} />
            </div>
            <div className="side">
              <span className="num">{price(h.eval_amount)}</span>
              <span className="sub num">{price(h.cur_price)} / 평단 {price(h.avg_price)}</span>
              <span className={`badge ${signClass(h.pnl_pct)}`}>{signed(Number(h.pnl_pct), fixedPct(h.pnl_pct))}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccountCard({ title, market, scope, summary, cash, fmt }: {
  title: string; market: "KR" | "US"; scope: Scope; summary: Summary | undefined; cash: Cash | undefined; fmt: (v: number | string) => string;
}) {
  const dim = scope !== "all" && scope !== market;
  return (
    <div className={`panel account${dim ? " dim" : ""}`}>
      <div className="panel-title">{title}</div>
      {summary ? (
        <dl>
          <dt>주식 평가</dt><dd>{fmt(summary.total_eval)}</dd>
          <dt>평가손익</dt>
          <dd className={signClass(summary.total_pnl)}>
            {signed(Number(summary.total_pnl), fmt(summary.total_pnl))} <span className="muted">({signed(Number(summary.total_pnl_pct), fixedPct(summary.total_pnl_pct))})</span>
          </dd>
          <dt>남은 예수금</dt>
          <dd className="cash">{cash ? fmt(cash.d2_deposit ?? cash.deposit) : "확인 중"}</dd>
        </dl>
      ) : (
        <div className="muted">아직 잔고를 불러오지 않았습니다.</div>
      )}
      {cash && (
        <div className="foot">
          D+2 기준 · 오늘 예수금 {fmt(cash.deposit)}
          {cash.orderable !== null && ` · 주문가능 ${fmt(cash.orderable)}`}
        </div>
      )}
    </div>
  );
}

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const scope = scopeOf((await searchParams).m);
  const [krSummary] = await query<Summary>("SELECT * FROM account_summary WHERE id = 1");
  // 예전 DB에는 워커가 처음 돌기 전까지 아래 테이블들이 없을 수 있습니다.
  const [usSummary] = await query<UsSummary>("SELECT * FROM us_account_summary WHERE id = 1").catch(() => []);
  const cash = await query<Cash>("SELECT * FROM cash_balances").catch(() => []);
  const holdings = await query<Holding>(
    `SELECT h.*, p.id AS position_id FROM holdings h
     LEFT JOIN positions p ON p.ticker = h.ticker AND p.status = 'open'
     ORDER BY h.market, h.eval_amount DESC`,
  );
  const alerts = await query<AlertRow>(
    `SELECT a.ticker, a.name, h.market, a.kind, a.direction, a.price, h.cur_price
     FROM alerts a JOIN holdings h ON h.ticker = a.ticker WHERE a.active`,
  );
  const tickers = holdings.filter((h) => scope === "all" || h.market === scope).map((h) => h.ticker);
  // 국내·해외 탭에 나눠 보여 주도록 시장마다 최신 8건씩 가져옵니다.
  const news = await query<News>(
    `SELECT * FROM (
       SELECT n.ticker, h.market, n.url, n.title, n.title_ko, n.source, n.published_at,
              row_number() OVER (PARTITION BY h.market ORDER BY n.published_at DESC) AS rn
       FROM stock_news n JOIN holdings h ON h.ticker = n.ticker
     ) t WHERE rn <= 8 ORDER BY published_at DESC`,
  ).catch(() =>
    // 번역 칸이 생기기 전(워커 업데이트 전) DB에서도 화면이 뜨도록 합니다.
    query<News>(
      `SELECT n.ticker, h.market, n.url, n.title, NULL AS title_ko, n.source, n.published_at
       FROM stock_news n JOIN holdings h ON h.ticker = n.ticker ORDER BY n.published_at DESC LIMIT 16`,
    ).catch(() => []),
  );
  const filings = await query<Filing>(
    `SELECT e.ticker, h.name, e.title, e.url, to_char(e.reported_on, 'YYYYMMDD') AS reported_day
     FROM stock_earnings e JOIN holdings h ON h.ticker = e.ticker
     WHERE e.ticker = ANY($1) AND e.reported_on >= CURRENT_DATE - 14 ORDER BY e.reported_on DESC LIMIT 3`,
    [tickers],
  ).catch(() => []);

  const upcoming = await query<CalendarEvent>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, market, ticker, title, detail FROM calendar_events
     WHERE day >= CURRENT_DATE AND day < CURRENT_DATE + 45 AND ($1 = 'all' OR market = $1)
     ORDER BY day, kind DESC LIMIT 6`,
    [scope],
  ).catch(() => []);

  const comments = await query<AiComment & { market: string }>(
    `SELECT DISTINCT ON (c.ticker) c.ticker, h.name, h.market, to_char(c.day, 'YYYY-MM-DD') AS day, c.tone, c.body
     FROM ai_comments c JOIN holdings h ON h.ticker = c.ticker ORDER BY c.ticker, c.day DESC`,
  ).catch(() => []);
  const summaries = await loadSummaries();
  const krCash = cash.find((c) => c.market === "KR");
  const usCash = cash.find((c) => c.market === "US");
  const rate = usSummary ? Number(usSummary.exch_rate) : 0;
  const total = totalOf(scope, account(krSummary, krCash), account(usSummary, usCash), rate);
  const fmtTotal = total.currency === "USD" ? usd : krw;
  const shown = holdings.filter((h) => scope === "all" || h.market === scope);
  const near = alerts
    .filter((a) => scope === "all" || a.market === scope)
    .map((a) => ({ ...a, dist: distancePct({ kind: a.kind, direction: a.direction, price: Number(a.price), cur: Number(a.cur_price) }) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);
  const groups: [string, Holding[]][] = scope === "all"
    ? [["국내", shown.filter((h) => h.market === "KR")], ["해외", shown.filter((h) => h.market === "US")]]
    : [["", shown]];
  const tabs: [Scope, string][] = [["all", "전체"], ["KR", "국내"], ["US", "해외"]];

  return (
    <>
      <div className="board-head">
        <h1>포트폴리오</h1>
        <nav className="segment" aria-label="계좌 범위">
          {tabs.map(([id, label]) => (
            <Link key={id} href={id === "all" ? "/" : `/?m=${id}`} aria-current={id === scope ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
      </div>

      <div className="board">
        <section>
          <div className="panel total">
            <div className="label">총자산 · 주식과 예수금 합계{scope === "all" && rate > 0 ? " · 원화 환산" : ""}</div>
            <div className="value">{fmtTotal(total.total)}</div>
            <div className={`pl ${signClass(total.pnl)}`}>
              {signed(total.pnl, fmtTotal(total.pnl))}　{signed(total.pnlPct, fixedPct(total.pnlPct))}
            </div>
            <div className="rule" />
            <div className="split">
              <div><div className="label">원화 예수금</div><div className="num">{krCash ? krw(krCash.d2_deposit ?? krCash.deposit) : "-"}</div></div>
              <div><div className="label">달러 예수금</div><div className="num">{usCash ? usd(usCash.d2_deposit ?? usCash.deposit) : "-"}</div></div>
            </div>
          </div>
          <AccountCard title="국내 주식 계좌" market="KR" scope={scope} summary={krSummary} cash={krCash} fmt={krw} />
          <AccountCard title="해외 주식 계좌" market="US" scope={scope} summary={usSummary} cash={usCash} fmt={usd} />
        </section>

        <section>
          <div className="panel flush holdings">
            <div className="panel-title">보유 종목 <span className="muted">{shown.length}종목</span></div>
            {shown.length === 0 ? (
              <div className="list-empty">
                {krSummary || usSummary ? "보유 종목이 없습니다." : "아직 키움 잔고를 불러오지 않았습니다. .env에 키움 앱키를 넣고 워커를 실행하세요."}
              </div>
            ) : (
              groups.map(([label, rows]) => rows.length > 0 && (
                <div key={label}>
                  {label && <div className="group-label">{label}</div>}
                  <HoldingRows rows={rows} summaries={summaries} />
                </div>
              ))
            )}
          </div>
        </section>

        <section className="side-right">
          <div className="panel check">
            <div className="panel-title">확인할 것</div>
            {near.length === 0 && filings.length === 0 ? (
              <div className="muted">켜진 손절·익절 알림이 없습니다. 매매일지에서 매수를 기록하면 생깁니다.</div>
            ) : (
              <ul className="feed">
                {near.map((a) => (
                  <li key={`${a.ticker}-${a.kind}-${a.price}`}>
                    <div className="row2">
                      <Link href={`/stock/${encodeURIComponent(a.ticker)}`}>{a.name}</Link>
                      <span className={`badge ${a.kind === "stop" ? "warn" : "gold"}`}>
                        {a.kind === "stop" ? "손절" : a.kind === "target" ? "익절" : "알림"}까지 {fixedPct(a.dist, 1)}
                      </span>
                    </div>
                    <div className="meta num">현재 {money(a.market)(a.cur_price)} → {money(a.market)(a.price)}</div>
                  </li>
                ))}
                {filings.map((f) => (
                  <li key={f.url + f.title}>
                    <div className="row2"><a href={f.url} target="_blank" rel="noopener noreferrer">{f.name} 실적 발표</a><span className="badge">{asOf(f.reported_day)}</span></div>
                    <div className="meta">{f.title}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <div className="panel-title">AI 한마디</div>
            {comments.filter((c) => scope === "all" || c.market === scope).length === 0 ? (
              <div className="muted">.env에 GEMINI_API_KEY(구글 무료 키)를 넣으면 장 마감 뒤 보유 종목마다 하루 한 번 점검 메모를 써 드려요.</div>
            ) : (
              <ul className="feed">
                {comments.filter((c) => scope === "all" || c.market === scope).map((c) => (
                  <li key={c.ticker}><AiNote c={c} title={<Link href={`/stock/${encodeURIComponent(c.ticker)}`}>{c.name}</Link>} /></li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <div className="panel-title">다가오는 일정 <Link href="/calendar" className="muted">전체 보기</Link></div>
            {upcoming.length === 0 ? (
              <div className="muted">앞으로 45일 동안 휴장일이나 실적 발표 예정이 없습니다.</div>
            ) : (
              <ul className="feed">{upcoming.map((e) => <EventLine key={e.day + e.kind + e.market + e.title} e={e} />)}</ul>
            )}
          </div>
          <div className="panel">
            <NewsTabs
              initial={scope === "US" || (scope === "all" && !news.some((n) => n.market === "KR")) ? "US" : "KR"}
              items={news.map((n) => ({
                key: n.ticker + n.url, market: n.market, ticker: n.ticker, title: n.title, titleKo: n.title_ko,
                url: n.url, meta: `${n.source} · ${kst(n.published_at)}`,
              }))}
            />
          </div>
        </section>
      </div>
    </>
  );
}
