import Link from "next/link";
import { query } from "@/lib/db";
import { loadBooks } from "@/lib/booksData";
import { skipped, type Book } from "@/lib/books";
import { afterBuy, afterSell, AFTER_DAYS, curve, verdict, VERDICT, type Bar } from "@/lib/replay";
import { daysBefore } from "@/lib/compare";
import { today } from "@/lib/format";
import ReturnChart, { type Mark } from "@/app/_components/ReturnChart";
import AskHistory from "@/app/_components/AskHistory";
import JournalTabs from "../JournalTabs";
import BookPicker from "./BookPicker";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);
const pct = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const tone = (v: number | null) => (v === null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const md = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8))}`;
const lastOf = (a: (number | null)[]) => [...a].reverse().find((v): v is number => v !== null) ?? null;
const COLOR = { held: "#8d887c", mine: "#c9a96b", bench: "#7fb8d6" };

function money(v: number, market: string) {
  return market === "US" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${Math.round(v).toLocaleString("ko-KR")}원`;
}

// 고를 수 있는 권: 산 기록이 있고 '일지 안 씀'만 있는 권이 아닌 것. 최근에 움직인 권부터
function replayable(books: Book[]): Book[] {
  const last = (b: Book) => b.pages.at(-1)?.day ?? "";
  return books.filter((b) => b.buys > 0 && !skipped(b)).sort((a, b) => last(b).localeCompare(last(a)));
}

export default async function ReplayPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const params = await searchParams;
  const books = replayable(await loadBooks().catch(() => [] as Book[]));
  const book = books.find((b) => b.key === params.b) ?? books[0];
  const day = today();
  const head = (
    <div className="board-head">
      <h1>매매일지</h1>
      <JournalTabs on="replay" />
    </div>
  );
  if (!book) {
    return <>{head}<div className="panel"><p className="muted">아직 복기할 매매가 없어요. 키움 체결이 들어오거나 매수 일지를 쓰면 여기서 산 뒤·판 뒤 주가를 돌아볼 수 있어요.</p></div></>;
  }

  const from = daysBefore(book.start ?? book.pages[0].day, 10);
  const bars: Bar[] = (await safe<{ day: string; close: string; high: string | null; low: string | null }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, close, high, low FROM price_history WHERE ticker = $1 AND day >= $2 ORDER BY day", [book.ticker, from],
  )).map((r) => ({ day: r.day, close: Number(r.close), high: r.high === null ? null : Number(r.high), low: r.low === null ? null : Number(r.low) }));
  const benchCode = book.market === "US" ? "SPX" : "KOSPI";
  const benchName = book.market === "US" ? "S&P 500" : "코스피";
  const bench: Bar[] = (await safe<{ day: string; close: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, close FROM sector_daily WHERE market = 'IX' AND code = $1 AND day >= $2 ORDER BY day", [benchCode, from],
  )).map((r) => ({ day: r.day, close: Number(r.close) }));
  const [pending] = await safe<{ value: { tickers?: [string, string][] } | null }>("SELECT value FROM app_settings WHERE key = 'history_request'");

  const trades = book.pages.map((p) => ({ day: p.day, side: p.side, quantity: p.quantity, price: p.price, fee: p.fee }));
  const c = book.startedBefore ? null : curve(trades, bars, bench);
  const lastBar = bars.at(-1)?.day ?? null;
  const stale = !lastBar || lastBar < daysBefore(day, 7);
  const idx = (d: string) => (c ? c.days.findIndex((x) => x >= d) : -1);
  const marks: Mark[] = c ? book.pages.map((p) => ({ i: idx(p.day), kind: p.side, series: 1 })).filter((m) => m.i >= 0) : [];
  const mine = c ? lastOf(c.mine) : null, held = c ? lastOf(c.held) : null, ix = c ? lastOf(c.bench) : null;

  return (
    <>
      {head}
      <AskHistory items={stale ? [[book.ticker, book.market]] : []} pending={(pending?.value?.tickers ?? []).map(([t]) => t)} />
      <div className="replay-bar">
        <BookPicker books={books.map((b) => ({
          key: b.key, label: `${b.name} · ${b.start ? md(b.start) : "기록 전"} ~ ${b.end ? md(b.end) : "보유 중"}${b.returnPct === null ? "" : ` (${pct(b.returnPct)})`}`,
        }))} value={book.key} />
        <Link href={`/journal/books?b=${encodeURIComponent(book.key)}`} className="chip-btn">일기장에서 보기</Link>
      </div>
      {stale && <p className="callout">{book.name} 일봉을 받는 중이에요. 워커가 받으면 이 화면이 저절로 새로 그려져요.</p>}

      {c ? (
        <>
          <div className="replay-kpis">
            <div className="stat"><span className="label">내 결과</span><b className={`stat-value ${tone(mine)}`}>{pct(mine)}</b><span className="muted">{book.end ? `${md(book.start!)} → ${md(book.end)} 다 판 기준` : "지금 보유 중"}</span></div>
            <div className="stat"><span className="label">계속 들고 있었다면</span><b className={`stat-value ${tone(held)}`}>{pct(held)}</b>
              <span className="muted">{held !== null && mine !== null ? (book.sells === 0 ? "아직 안 팔았어요" : mine >= held ? `판 덕분에 ${pct(mine - held).replace("%", "%p")} 지켰어요` : `안 팔았으면 ${pct(held - mine).replace("%", "%p").replace("+", "")} 더 나았어요`) : ""}</span></div>
            <div className="stat"><span className="label">같은 기간 {benchName}</span><b className={`stat-value ${tone(ix)}`}>{pct(ix)}</b>
              <span className="muted">{ix !== null && mine !== null ? `시장보다 ${pct(mine - ix).replace("%", "%p")}` : "지수 일봉을 받는 중이에요"}</span></div>
          </div>
          <div className="panel">
            <span className="label">첫 매수 날부터 · 넣은 돈 대비 수익률</span>
            <ReturnChart days={c.days} marks={marks} series={[
              { label: "계속 보유", color: COLOR.held, values: c.held },
              { label: "내 결과", color: COLOR.mine, values: c.mine },
              { label: benchName, color: COLOR.bench, values: c.bench, dashed: true },
            ]} />
            <p className="chart-foot">내 결과는 남은 주식 평가액과 판 돈(수수료·세금 뺀 값)을 넣은 돈과 비교했어요. 계속 보유는 산 주식을 하나도 안 팔았을 때예요.</p>
          </div>
        </>
      ) : (
        <div className="panel"><p className="muted">{book.startedBefore
          ? "키움 기록보다 먼저 산 주식이 들어 있어서 수익률 선은 그리지 않았어요. 아래 매매별 복기만 보여 드려요."
          : "산 날부터 일봉이 아직 없어요."}</p></div>
      )}

      <div className="replay-cards">
        {book.pages.map((p) => {
          if (p.side === "buy") {
            const a = afterBuy(bars, p.day, book.end, p.price);
            return (
              <div key={p.id} className="replay-card">
                <span className="muted">{md(p.day)} {p.label} {money(p.price, book.market)} × {p.quantity.toLocaleString("ko-KR")}주</span>
                <p>{!a ? "산 뒤 주가가 아직 없어요" : a.down > -0.5
                  ? <>산 뒤 {book.end ? "다 판 날까지" : "지금까지"} 산 값 아래로 거의 안 내려가고 <span className="up">{pct(a.up)}</span>까지 올랐어요</>
                  : <>산 뒤 {book.end ? "다 판 날까지" : "지금까지"} 최대 <span className="down">{pct(a.down)}</span> 내려갔다가 <span className={tone(a.up)}>{pct(a.up)}</span>까지 올랐어요</>}</p>
              </div>
            );
          }
          const a = afterSell(bars, p.day, p.price);
          const ret = p.avgCost ? (p.price / p.avgCost - 1) * 100 : null;
          const v = a && a.days >= AFTER_DAYS ? verdict(a) : null;
          return (
            <div key={p.id} className={`replay-card${v === "early" ? " early" : ""}`}>
              <span className="muted">{md(p.day)} {p.label} {money(p.price, book.market)}{ret !== null && <> · 수익 <span className={tone(ret)}>{pct(ret)}</span></>}</span>
              <p>{a ? <>판 뒤 {a.days}거래일 <span className={tone(a.pct)}>{pct(a.pct)}</span> {a.pct >= 0 ? "더 올랐어요" : "내렸어요"}
                {v ? <> → <b className={v === "early" ? "up" : v === "good" ? "gold" : "muted"}>{VERDICT[v]}</b></> : <span className="muted"> (아직 {AFTER_DAYS}거래일이 안 지났어요)</span>}</> : "판 뒤 주가가 아직 없어요"}</p>
            </div>
          );
        })}
      </div>
      <p className="chart-foot">판정: 판 뒤 {AFTER_DAYS}거래일 동안 +5% 넘게 오르면 일찍 팜, −3% 넘게 내리면 잘 팜, 그 사이면 비슷.</p>
    </>
  );
}
