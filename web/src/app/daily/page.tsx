import Link from "next/link";
import { query } from "@/lib/db";
import { today } from "@/lib/format";
import { usdKrw } from "@/lib/fx";
import { loadBooks } from "@/lib/booksData";
import { cellColor, dailyChanges, monthCells, monthOf, monthSummary, shiftMonth, shortWon, type AssetRow } from "@/lib/daily";

export const dynamic = "force-dynamic";

type Params = { m?: string; d?: string };
const WEEK = "일월화수목금토";
const sp = (v: number | null, digits = 1) => (v === null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
const cls = (v: number | null) => (v === null || v === 0 ? "" : v > 0 ? "up" : "down");
const wonFull = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("ko-KR")}원`;
const label = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${m}월 ${d}일 (${WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
};
const ICON: Record<string, string> = { policy: "🏦", economic: "📊", earnings: "💼", dividend: "💰", holiday: "🏖️" };
const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);

export default async function DailyPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const now = today();
  const month = /^\d{4}-\d{2}$/.test(params.m ?? "") ? params.m! : monthOf(params.d ?? now);
  const rows = (await safe<{ day: string; total: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, total FROM asset_history ORDER BY day"))
    .map((r): AssetRow => ({ day: r.day, total: Number(r.total) }));
  const changes = dailyChanges(rows);
  const sum = monthSummary(rows, changes, month);

  // 판 것 손익(원화). 총자산 기록이 없는 옛날 날짜에도 보여 줘요. 달러는 지금 환율로 바꿔요.
  const rate = await usdKrw();
  const realized = new Map<string, number>();
  const closedOn = new Map<string, { name: string; key: string; ret: number | null }[]>();
  for (const b of await loadBooks()) {
    for (const p of b.pages) {
      if (p.side !== "sell" || p.pnl === null) continue;
      realized.set(p.day, (realized.get(p.day) ?? 0) + p.pnl * (b.market === "US" ? rate : 1));
    }
    if (b.end) closedOn.set(b.end, [...(closedOn.get(b.end) ?? []), { name: b.name, key: b.key, ret: b.returnPct }]);
  }

  const cells = monthCells(month);
  const recorded = cells.filter((d): d is string => !!d && (changes.has(d) || realized.has(d)));
  const day = params.d && monthOf(params.d) === month ? params.d : recorded.at(-1) ?? (monthOf(now) === month ? now : `${month}-01`);
  const ch = changes.get(day);

  const [movers, fills, events] = await Promise.all([
    safe<{ name: string; pct: string }>(
      `SELECT h.name, (p.close / NULLIF((SELECT close FROM price_history q WHERE q.ticker = h.ticker AND q.day < $1 ORDER BY q.day DESC LIMIT 1), 0) - 1) * 100 AS pct
       FROM (SELECT ticker, name FROM holdings WHERE quantity > 0 UNION SELECT ticker, name FROM isa_holdings WHERE quantity > 0) h
       JOIN price_history p ON p.ticker = h.ticker AND p.day = $1`, [day]),
    safe<{ name: string; side: "buy" | "sell"; quantity: string; isa: boolean }>(
      `SELECT COALESCE(NULLIF(name, ''), ticker) AS name, side, sum(quantity) AS quantity, false AS isa FROM trade_fills WHERE trade_date = $1 GROUP BY 1, 2
       UNION ALL SELECT COALESCE(NULLIF(name, ''), ticker), side, sum(quantity), true FROM isa_fills WHERE trade_date = $1 GROUP BY 1, 2
       ORDER BY 1`, [day]),
    safe<{ kind: string; title: string }>("SELECT kind, title FROM calendar_events WHERE day = $1 ORDER BY kind, title", [day]),
  ]);
  const top = movers.map((m) => ({ name: m.name, pct: Number(m.pct) })).filter((m) => Number.isFinite(m.pct))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);
  const closed = closedOn.get(day) ?? [];
  const first = rows[0]?.day;

  return (
    <>
      <div className="board-head">
        <h1>포트폴리오</h1>
        <nav className="segment" aria-label="포트폴리오 보기">
          <Link href="/">보유 종목</Link>
          <Link href="/weights">비중</Link>
          <Link href="/daily" aria-current="page">달력</Link>
        </nav>
      </div>

      <div className="daily">
        <section className="panel">
          <div className="daily-head">
            <Link href={`/daily?m=${shiftMonth(month, -1)}`} aria-label="지난달">‹</Link>
            <b>{month.slice(0, 4)}년 {Number(month.slice(5))}월</b>
            <Link href={`/daily?m=${shiftMonth(month, 1)}`} aria-label="다음 달">›</Link>
            {sum.change !== null && (
              <span className={`daily-sum ${cls(sum.change)}`}>{sp(sum.pct)} ({shortWon(sum.change)}원)</span>
            )}
            {sum.change !== null && <span className="muted">오른 날 {sum.ups} · 내린 날 {sum.downs}{sum.from ? ` · ${Number(sum.from.slice(8))}일 기록부터` : ""}</span>}
          </div>
          <div className="cal7" role="grid" aria-label={`${month} 수익 달력`}>
            {[...WEEK].map((w) => <div key={w} className="cal7-wd">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const c = changes.get(d);
              const r = realized.get(d);
              const future = d > now;
              return (
                <Link key={d} href={`/daily?m=${month}&d=${d}`} className={`cal7-c${d === day ? " sel" : ""}${future ? " future" : ""}`}
                  style={{ background: cellColor(c?.pct ?? null) }} aria-current={d === day ? "date" : undefined}>
                  <span className="cal7-dn">{Number(d.slice(8))}</span>
                  {c?.pct != null ? (
                    <span className="cal7-v">{sp(c.pct)}</span>
                  ) : r !== undefined ? (
                    <span className={`cal7-r ${cls(r)}`}>판 것 {shortWon(r)}</span>
                  ) : null}
                  {closedOn.has(d) && <i className="cal7-dot" title="다 판 종목이 있어요" />}
                </Link>
              );
            })}
          </div>
          <p className="muted daily-note">
            내 돈 전체(국내·해외·ISA, 원화 환산)가 전날 기록보다 얼마나 변했는지예요. 빨강은 오름, 파랑은 내림이에요. 입금·출금도 변화에 들어가요.
            {first ? ` 날마다 기록은 ${Number(first.slice(5, 7))}월 ${Number(first.slice(8))}일부터 쌓이고 있어요.` : ""} 그 전 날짜는 판 것 손익만 보여요.
          </p>
        </section>

        <aside className="panel daily-detail">
          <div className="panel-title">{label(day)}</div>
          {ch?.change != null ? (
            <>
              <div className={`daily-big ${cls(ch.change)}`}>{sp(ch.pct, 2)} · {wonFull(ch.change)}</div>
              <div className="muted">총자산 {Math.round(ch.total).toLocaleString("ko-KR")}원</div>
            </>
          ) : ch ? (
            <div className="muted">첫 기록이라 비교할 전날이 없어요 · 총자산 {Math.round(ch.total).toLocaleString("ko-KR")}원</div>
          ) : (
            <div className="muted">이날은 총자산 기록이 없어요.</div>
          )}
          {realized.has(day) && <p>판 것 손익 <b className={cls(realized.get(day)!)}>{wonFull(realized.get(day)!)}</b></p>}

          {top.length > 0 && (
            <>
              <div className="daily-sec">많이 움직인 종목 <span className="muted">지금 들고 있는 것 중</span></div>
              <p>{top.map((m, i) => <span key={m.name}>{i > 0 && " · "}{m.name} <span className={cls(m.pct)}>{sp(m.pct)}</span></span>)}</p>
            </>
          )}
          {(fills.length > 0 || closed.length > 0) && (
            <>
              <div className="daily-sec">그날 매매</div>
              {closed.map((c) => (
                <p key={c.key}><Link href={`/journal/books?b=${encodeURIComponent(c.key)}`}>{c.name}</Link> 전량 매도 · <span className={cls(c.ret)}>{sp(c.ret)}</span> → 일기장</p>
              ))}
              {fills.map((f) => (
                <p key={`${f.name}${f.side}${f.isa}`}>{f.name} {f.side === "buy" ? <span className="up">매수</span> : <span className="down">매도</span>} {Number(f.quantity)}주{f.isa ? " · ISA" : ""}</p>
              ))}
            </>
          )}
          {events.length > 0 && (
            <>
              <div className="daily-sec">그날 일정</div>
              {events.map((e) => <p key={e.title}>{ICON[e.kind] ?? "📌"} {e.title}</p>)}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
