import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { marketOf } from "@/lib/journal";
import { BEFORE, decodeGame, encodeGame, randomStart, STEPS } from "@/lib/practice";
import { signClass } from "@/lib/format";
import WatchTabs from "../WatchTabs";
import PracticeView from "./PracticeView";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);
const HISTORY = 250; // 시작 전에 넘겨 주는 봉(1년 기간·120일선까지 보이게)
const MIN_BEFORE = 30; // 직접 고를 때는 앞에 이만큼만 있어도 돼요

type Row = { day: string; open: string | null; high: string | null; low: string | null; close: string; volume: string | null };
type Past = { id: number; ticker: string; name: string; start_day: string; end_day: string; blind: boolean; return_pct: string; hold_pct: string; calls: number; hits: number };

async function nameOf(ticker: string): Promise<string> {
  const [row] = await safe<{ name: string }>(
    `SELECT name FROM (SELECT name, 1 AS k FROM practice_pool WHERE ticker = $1 UNION ALL SELECT name, 2 FROM watchlist WHERE ticker = $1
       UNION ALL SELECT name, 3 FROM holdings WHERE ticker = $1 UNION ALL SELECT name, 4 FROM screener_stocks WHERE ticker = $1) t
     WHERE name <> '' ORDER BY k LIMIT 1`, [ticker],
  );
  return row?.name ?? ticker;
}

// 🎲: 일봉이 넉넉한 종목 중 하나, 그 안의 아무 시점
async function rollDice(): Promise<string | null> {
  const tickers = await safe<{ ticker: string }>(
    "SELECT ticker FROM price_history GROUP BY ticker HAVING count(*) >= $1", [BEFORE + STEPS + 1],
  );
  for (let tries = 0; tries < 3 && tickers.length; tries++) {
    const { ticker } = tickers[Math.floor(Math.random() * tickers.length)];
    const days = (await safe<{ day: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM price_history WHERE ticker = $1 ORDER BY day", [ticker])).map((r) => r.day);
    const start = randomStart(days);
    if (start) return encodeGame({ ticker, start, blind: true });
  }
  return null;
}

export default async function PracticePage({ searchParams }: { searchParams: Promise<{ g?: string; dice?: string; t?: string; d?: string }> }) {
  const sp = await searchParams;
  if (sp.dice) {
    const g = await rollDice();
    redirect(g ? `/watch/practice?g=${g}` : "/watch/practice?none=1");
  }
  let pickError: string | null = null;
  if (sp.t) {
    // 직접 고르기: 고른 날짜(없으면 1년 전) 이후 첫 봉에서 시작. 이름과 날짜를 보고 해요.
    const ticker = sp.t.trim().toUpperCase();
    const days = (await safe<{ day: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM price_history WHERE ticker = $1 ORDER BY day", [ticker])).map((r) => r.day);
    const want = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : days.at(-1 - STEPS) ?? "";
    const found = days.findIndex((d) => d >= want);
    const at = Math.max(Math.min(found < 0 ? days.length : found, days.length - 2), MIN_BEFORE);
    if (days.length < MIN_BEFORE + 2) pickError = `${ticker}는 앱에 일봉이 ${days.length}개뿐이라 연습할 수 없어요. 관심종목에 넣으면 워커가 일봉을 받아 와요.`;
    else redirect(`/watch/practice?g=${encodeGame({ ticker, start: days[at], blind: false })}`);
  }

  const [pool] = await safe<{ ready: string; total: string }>(
    "SELECT count(*) FILTER (WHERE fetched_at IS NOT NULL AND error IS NULL) AS ready, count(*) AS total FROM practice_pool",
  );
  const past = await safe<Past>(
    `SELECT id, ticker, name, to_char(start_day, 'YYYY-MM-DD') AS start_day, to_char(end_day, 'YYYY-MM-DD') AS end_day, blind, return_pct, hold_pct, calls, hits
     FROM practice_sessions ORDER BY created_at DESC LIMIT 10`,
  );
  const names = await safe<{ ticker: string; name: string }>(
    `SELECT DISTINCT ON (ticker) ticker, name FROM (SELECT ticker, name, 1 AS k FROM watchlist UNION ALL SELECT ticker, name, 2 FROM holdings
       UNION ALL SELECT ticker, name, 3 FROM practice_pool WHERE fetched_at IS NOT NULL AND error IS NULL) t WHERE name <> '' ORDER BY ticker, k`,
  );

  const game = decodeGame(sp.g);
  let view = null;
  if (game) {
    const rows = await safe<Row>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close, volume FROM price_history WHERE ticker = $1 ORDER BY day`, [game.ticker],
    );
    const at = rows.findIndex((r) => r.day === game.start);
    if (at >= 0) {
      const from = Math.max(0, at - HISTORY);
      const slice = rows.slice(from, at + STEPS + 1).map((r) => {
        const close = Number(r.close);
        return { day: r.day, open: Number(r.open ?? close), high: Number(r.high ?? close), low: Number(r.low ?? close), close, volume: r.volume === null ? null : Number(r.volume) };
      });
      view = { candles: slice, start: at - from, name: await nameOf(game.ticker), market: marketOf(game.ticker, "US") };
    }
  }

  const wins = past.filter((p) => Number(p.return_pct) > Number(p.hold_pct)).length;
  return (
    <>
      <div className="board-head">
        <h1>관심종목</h1>
        <WatchTabs on="practice" />
      </div>

      {game && view ? (
        <PracticeView key={sp.g} game={sp.g!} blind={game.blind} ticker={game.ticker} name={view.name} market={view.market} candles={view.candles} start={view.start} />
      ) : (
        <section className="panel practice-start">
          <h2>차트 보는 눈 연습</h2>
          <p className="muted">
            지난 차트를 한 봉씩 넘기면서 <b>산다 · 판다 · 지켜본다</b>를 골라요. 다 넘기면 종목과 날짜, 내 수익률과 그냥 들고 있었을 때 수익률이 공개돼요.
            작도 도구와 지표는 종목 화면과 똑같이 쓸 수 있고, 연습 기록은 진짜 매매일지와 섞이지 않아요.
          </p>
          <Link className="button practice-dice" href="/watch/practice?dice=1">🎲 아무 종목</Link>
          <p className="muted practice-small">
            🎲는 종목 이름과 날짜를 가리고, 가격도 시작 봉을 100으로 바꿔 보여 줘요. 차트 모양만 보고 판단하는 연습이에요.
            {pool && Number(pool.total) > 0 && ` 연습용 종목 ${pool.ready}/${pool.total}개 준비됨${Number(pool.ready) < Number(pool.total) ? " (워커가 1분에 2개씩 받는 중)" : ""}.`}
          </p>
          {"none" in sp && <p className="practice-warn">아직 연습할 만큼 일봉이 쌓인 종목이 없어요. 워커가 연습용 종목 일봉을 받는 중이니 조금 뒤에 다시 눌러 주세요.</p>}
          <form className="row practice-pick" action="/watch/practice">
            <input name="t" list="practice-names" placeholder="종목코드·티커 (005930, AAPL)" required />
            <datalist id="practice-names">{names.map((n) => <option key={n.ticker} value={n.ticker}>{n.name}</option>)}</datalist>
            <input name="d" type="date" aria-label="시작 날짜" />
            <button type="submit">이 종목으로 연습</button>
          </form>
          <p className="muted practice-small">직접 고르면 이름과 날짜가 보여요. 날짜를 비우면 {STEPS}봉 전부터 시작해요.</p>
          {pickError && <p className="practice-warn">{pickError}</p>}
        </section>
      )}

      {past.length > 0 && (
        <section className="panel practice-past">
          <h2>지난 연습 <span className="muted practice-small">최근 {past.length}번 중 그냥 들고 있기보다 잘한 판 {wins}번</span></h2>
          <div className="list">
            {past.map((p) => (
              <div key={p.id} className="list-item practice-row">
                <span>{p.blind ? "🎲 " : ""}<b>{p.name || p.ticker}</b> <span className="muted">{p.ticker} · {p.start_day} ~ {p.end_day}</span></span>
                <span>내 수익 <b className={signClass(Number(p.return_pct))}>{Number(p.return_pct) > 0 ? "+" : ""}{Number(p.return_pct).toFixed(2)}%</b></span>
                <span className="muted">들고만 있었으면 {Number(p.hold_pct) > 0 ? "+" : ""}{Number(p.hold_pct).toFixed(2)}%</span>
                <span className="muted">맞힘 {p.hits}/{p.calls}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
