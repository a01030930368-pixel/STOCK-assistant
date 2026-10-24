import Link from "next/link";
import { query } from "@/lib/db";
import { signClass, today } from "@/lib/format";
import { encodeGame } from "@/lib/practice";
import { filterSessions, habits, HABIT_FROM, insights, summarize, won, type Filter, type Session, type Side } from "@/lib/practiceLog";
import WatchTabs from "../../WatchTabs";
import PracticeTabs from "../PracticeTabs";

export const dynamic = "force-dynamic";

const PAGE = 30;
type Row = { id: number; ticker: string; name: string; start_day: string; end_day: string; blind: boolean; trades: Session["trades"] | null;
  return_pct: string; hold_pct: string; calls: number; hits: number; played: string };

const KINDS: { key: Filter["kind"]; label: string }[] = [{ key: "all", label: "전체" }, { key: "blind", label: "🎲 판" }, { key: "pick", label: "직접 고른 판" }];
const MARKETS: { key: Filter["market"]; label: string }[] = [{ key: "all", label: "전체" }, { key: "KR", label: "국내" }, { key: "US", label: "미국" }];
const sg = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const dot = (d: string) => d.slice(5).replace("-", ".");

export default async function PracticeLogPage({ searchParams }: { searchParams: Promise<{ k?: string; m?: string; n?: string }> }) {
  const sp = await searchParams;
  const rows = await query<Row>(
    `SELECT id, ticker, name, to_char(start_day, 'YYYY-MM-DD') AS start_day, to_char(end_day, 'YYYY-MM-DD') AS end_day, blind, trades,
       return_pct, hold_pct, calls, hits, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS played
     FROM practice_sessions ORDER BY created_at DESC, id DESC`,
  ).catch(() => [] as Row[]);
  const all: Session[] = rows.map((r) => ({
    id: r.id, ticker: r.ticker, name: r.name, start: r.start_day, end: r.end_day, blind: r.blind, trades: Array.isArray(r.trades) ? r.trades : [],
    mine: Number(r.return_pct), hold: Number(r.hold_pct), calls: r.calls, hits: r.hits, played: r.played,
  }));
  const f: Filter = { kind: KINDS.find((x) => x.key === sp.k)?.key ?? "all", market: MARKETS.find((x) => x.key === sp.m)?.key ?? "all" };
  const list = filterSessions(all, f);
  const sum = summarize(list, today());
  const splits = habits(list);
  const notes = insights(list);
  const shown = Math.max(PAGE, Math.min(Number(sp.n) || PAGE, list.length));
  const href = (q: Partial<Filter> & { n?: number }) => {
    const p = new URLSearchParams();
    const k = q.kind ?? f.kind, m = q.market ?? f.market;
    if (k !== "all") p.set("k", k);
    if (m !== "all") p.set("m", m);
    if (q.n) p.set("n", String(q.n));
    return `/watch/practice/log${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <div className="board-head">
        <h1>관심종목</h1>
        <WatchTabs on="practice" />
      </div>
      <PracticeTabs on="log" count={all.length} />

      {all.length === 0 ? (
        <section className="panel"><p className="muted">아직 끝낸 연습이 없어요. 연습하기에서 한 판을 끝까지 넘기면 여기에 쌓여요.</p></section>
      ) : (
        <>
          <div className="row practice-filter">
            <nav className="segment" aria-label="판 종류">
              {KINDS.map((x) => <Link key={x.key} href={href({ kind: x.key })} aria-current={x.key === f.kind ? "page" : undefined}>{x.label}</Link>)}
            </nav>
            <nav className="segment" aria-label="시장">
              {MARKETS.map((x) => <Link key={x.key} href={href({ market: x.key })} aria-current={x.key === f.market ? "page" : undefined}>{x.label}</Link>)}
            </nav>
          </div>

          <div className="stats">
            <div className="stat"><div className="stat-label">연습한 판</div><div className="stat-value">{sum.count}판</div><div className="stat-sub">이번 달 {sum.thisMonth}판</div></div>
            <div className="stat"><div className="stat-label">들고만 있기보다 잘한 판</div><div className="stat-value gold">{sum.wins}판</div><div className="stat-sub">{sum.winPct}%</div></div>
            <div className="stat"><div className="stat-label">평균 수익</div><div className={`stat-value ${signClass(sum.avgMine)}`}>{sg(sum.avgMine)}</div><div className="stat-sub">들고만 있었으면 {sg(sum.avgHold)}</div></div>
            <div className="stat"><div className="stat-label">맞힘률</div><div className="stat-value">{sum.hitPct === null ? "-" : `${sum.hitPct}%`}</div><div className="stat-sub">산다·판다 뒤 5봉 방향</div></div>
          </div>

          <section className="practice-habits">
            <div className="panel">
              <h2>어떤 판에서 잘하나 <span className="muted practice-small">이긴 판 비율</span></h2>
              {list.length < HABIT_FROM || splits.length === 0 ? (
                <p className="muted">판이 {HABIT_FROM}판 넘게 쌓이고 양쪽에 3판씩은 있어야 비교할 수 있어요. 지금 {list.length}판이에요.</p>
              ) : splits.map((s) => (
                <div key={s.title} className="habit">
                  <div className="habit-head"><span>{s.title}</span>{s.note && <span className="gold">{s.note}</span>}</div>
                  <HabitBar side={s.a} lead />
                  <HabitBar side={s.b} />
                </div>
              ))}
            </div>
            <div className="practice-insights">
              <h2>요즘 내 버릇</h2>
              {list.length < HABIT_FROM || notes.length === 0
                ? <p className="muted">{list.length < HABIT_FROM ? `${HABIT_FROM}판부터 찾아 드려요.` : "눈에 띄는 버릇이 아직 없어요."}</p>
                : notes.map((n) => <div key={n} className="insight">{n}</div>)}
            </div>
          </section>

          <section className="panel practice-log">
            <h2>모든 판 <span className="muted practice-small">최신순 · {list.length}판</span></h2>
            {list.length === 0 && <p className="muted">여기에 해당하는 판이 없어요.</p>}
            <div className="list">
              {list.slice(0, shown).map((s) => (
                <div key={s.id} className="list-item practice-row">
                  <span className="muted log-day">{dot(s.played)}</span>
                  <span className="log-name">{s.blind ? "🎲 " : ""}<b>{s.name || s.ticker}</b> <span className="muted">{s.start.slice(0, 7).replace("-", ".")}~</span></span>
                  <span>내 <b className={signClass(s.mine)}>{sg(s.mine)}</b></span>
                  <span className="muted">들고만 {sg(s.hold)}</span>
                  <span className="muted">맞힘 {s.hits}/{s.calls}</span>
                  <span className="muted">매매 {s.trades.length}번</span>
                  <span className={won(s) ? "log-res win" : "log-res muted"}>{won(s) ? "이김" : s.mine === s.hold ? "비김" : "짐"}</span>
                  <Link className="log-again" href={`/watch/practice?g=${encodeGame({ ticker: s.ticker, start: s.start, blind: s.blind })}`}>↻ 같은 판 다시</Link>
                </div>
              ))}
            </div>
            {list.length > shown && <p className="log-more"><Link href={href({ n: shown + PAGE })}>더 보기 ({list.length - shown}판)</Link></p>}
          </section>
        </>
      )}
    </>
  );
}

function HabitBar({ side, lead }: { side: Side; lead?: boolean }) {
  return (
    <div className={lead ? "habit-bar lead" : "habit-bar"}>
      <span className="habit-label">{side.label} <span className="muted">{side.n}판</span></span>
      <span className="habit-track"><i style={{ width: `${side.winPct}%` }} /></span>
      <span className="habit-pct">{side.winPct}%</span>
    </div>
  );
}
