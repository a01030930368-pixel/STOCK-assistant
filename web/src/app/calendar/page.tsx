import Link from "next/link";
import { monthGrid, monthOf, shift, ym } from "@/lib/calendar";
import { query } from "@/lib/db";
import { today } from "@/lib/format";
import EventLine, { WEEK, type CalendarEvent } from "../_components/EventLine";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const now = today();
  const month = monthOf((await searchParams).ym, now);
  const first = `${ym(month)}-01`;
  const next = `${ym(shift(month, 1))}-01`;
  // 워커가 캘린더를 처음 만들기 전에는 테이블이 없을 수 있습니다.
  const events = await query<CalendarEvent>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, market, ticker, title, detail FROM calendar_events
     WHERE day >= $1 AND day < $2 ORDER BY day, kind DESC, title`,
    [first, next],
  ).catch(() => []);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  return (
    <>
      <div className="board-head">
        <h1>일정</h1>
        <nav className="month-nav" aria-label="달 이동">
          <Link href={`/calendar?ym=${ym(shift(month, -1))}`} aria-label="이전 달">‹</Link>
          <strong>{month.year}.{String(month.month).padStart(2, "0")}</strong>
          <Link href={`/calendar?ym=${ym(shift(month, 1))}`} aria-label="다음 달">›</Link>
        </nav>
      </div>

      <div className="panel flush cal">
        <div className="cal-row cal-head">{WEEK.map((w) => <div key={w}>{w}</div>)}</div>
        {monthGrid(month).map((week, i) => (
          <div className="cal-row" key={i}>
            {week.map((day, j) => {
              const list = day ? byDay.get(day) ?? [] : [];
              const off = list.some((e) => e.kind === "holiday" && e.market === "KR") || j === 0;
              return (
                <div key={j} className={`cal-cell${day ? "" : " empty"}${day === now ? " today" : ""}`}>
                  {day && <span className={`cal-num${off ? " up" : j === 6 ? " down" : ""}`}>{Number(day.slice(8))}</span>}
                  {list.map((e) => (
                    <span key={e.kind + e.market + e.title} className={`cal-chip ${e.kind}`} title={e.detail || e.title}>
                      {e.kind === "earnings" ? e.title.replace(" 실적 발표", " 실적") : e.title.replace(" 휴장 · ", " 휴장 ")}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">이달 일정 <span className="muted">{events.length}건</span></div>
        {events.length === 0 ? (
          <div className="muted">이달에는 일정이 없습니다. 워커가 12시간마다 휴장일과 미국 보유 종목 실적 발표 예정일을 가져옵니다.</div>
        ) : (
          <ul className="feed">{events.map((e) => <EventLine key={e.day + e.kind + e.market + e.title} e={e} />)}</ul>
        )}
        <div className="muted" style={{ marginTop: 12, fontSize: "0.8rem" }}>국내 종목 실적 발표일은 미리 공개되는 무료 자료가 없어서, 공시가 나오면 포트폴리오의 "확인할 것"에 표시됩니다.</div>
      </div>
    </>
  );
}
