import Link from "next/link";
import { monthGrid, monthOf, shift, ym } from "@/lib/calendar";
import { query } from "@/lib/db";
import { today } from "@/lib/format";
import EventLine, { WEEK, type CalendarEvent } from "../_components/EventLine";

export const dynamic = "force-dynamic";

type Payer = { ticker: string; name: string; market: "KR" | "US"; quantity: string; per_share: string; times: number; next_day: string | null; next_title: string | null };
const money = (market: string, v: number) => (market === "KR" ? `${Math.round(v).toLocaleString("ko-KR")}원` : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

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
  ).catch(() => [] as CalendarEvent[]);
  // 기업 공부 노트 ⑥에 날짜를 넣은 일도 같이 보여요.
  const studied = await query<CalendarEvent>(
    `SELECT e->>'day' AS day, 'study' AS kind, s.market, s.ticker, '📒 ' || s.name || ' · ' || (e->>'text') AS title, '기업 공부 노트에 적은 일' AS detail
     FROM study_notes s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.fields->'events') = 'array' THEN s.fields->'events' ELSE '[]'::jsonb END) e
     WHERE s.status <> '탈락' AND (e->>'day') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (e->>'day') >= $1 AND (e->>'day') < $2`,
    [first, next],
  ).catch(() => []);
  events.push(...studied);
  events.sort((a, b) => a.day.localeCompare(b.day));
  // 보유 종목의 최근 1년 배당. 같은 금액을 앞으로 1년 동안 받는다고 보고 예상 배당금을 셉니다.
  const payers = await query<Payer>(
    `SELECT h.ticker, h.name, h.market, h.quantity, sum(d.amount) AS per_share, count(*)::int AS times,
       (SELECT to_char(day, 'YYYY-MM-DD') FROM calendar_events c WHERE c.kind = 'dividend' AND c.ticker = h.ticker AND c.day >= CURRENT_DATE ORDER BY day LIMIT 1) AS next_day,
       (SELECT title FROM calendar_events c WHERE c.kind = 'dividend' AND c.ticker = h.ticker AND c.day >= CURRENT_DATE ORDER BY day LIMIT 1) AS next_title
     FROM holdings h JOIN stock_dividends d ON d.ticker = h.ticker AND d.ex_date > CURRENT_DATE - 365 AND d.ex_date <= CURRENT_DATE
     WHERE h.quantity > 0 GROUP BY h.ticker, h.name, h.market, h.quantity ORDER BY h.market, sum(d.amount) * h.quantity DESC`,
  ).catch(() => []);
  const yearly = (m: string) => payers.filter((p) => p.market === m).reduce((s, p) => s + Number(p.per_share) * Number(p.quantity), 0);
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
                      {e.kind === "earnings" ? e.title.replace(" 실적 발표", " 실적") : e.kind === "dividend" ? e.title.replace(" (예상)", "") : e.title.replace(" 휴장 · ", " 휴장 ").replace(/\(.*\)/, "")}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="panel flush" style={{ marginTop: 16 }}>
        <div className="panel-title">예상 배당 <span className="muted">최근 1년 배당 기준 · 세전</span></div>
        {payers.length === 0 ? (
          <div className="list-empty">최근 1년 안에 배당을 준 보유 종목이 없거나, 워커가 아직 배당 기록을 받지 않았어요(12시간마다 받아요).</div>
        ) : (
          <>
            <div className="div-sum">
              {yearly("KR") > 0 && <span>국내 1년 약 <b className="num">{money("KR", yearly("KR"))}</b></span>}
              {yearly("US") > 0 && <span>미국 1년 약 <b className="num">{money("US", yearly("US"))}</b></span>}
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>종목</th><th className="num">최근 1년 주당</th><th className="num">보유</th><th className="num">1년 예상 배당금</th><th>다음 배당락</th></tr></thead>
                <tbody>
                  {payers.map((p) => (
                    <tr key={p.ticker}>
                      <td><Link className="stock-link" href={`/stock/${encodeURIComponent(p.ticker)}`}>{p.name}</Link> <span className="muted code">{p.times}회</span></td>
                      <td className="num">{money(p.market, Number(p.per_share))}</td>
                      <td className="num">{Number(p.quantity).toLocaleString("ko-KR")}주</td>
                      <td className="num gold">{money(p.market, Number(p.per_share) * Number(p.quantity))}</td>
                      <td>{p.next_day ? <>{p.next_day.slice(5).replace("-", ".")} {p.next_title?.includes("예상") && <span className="muted">(예상)</span>}</> : <span className="muted">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">이달 일정 <span className="muted">{events.length}건</span></div>
        {events.length === 0 ? (
          <div className="muted">이달에는 일정이 없습니다. 워커가 12시간마다 휴장일, 미국 보유 종목 실적 발표 예정일, 금리 결정·경제지표 발표일, 보유 종목 배당락일을 가져옵니다.</div>
        ) : (
          <ul className="feed">{events.map((e) => <EventLine key={e.day + e.kind + e.market + e.title} e={e} />)}</ul>
        )}
        <div className="muted" style={{ marginTop: 12, fontSize: "0.8rem" }}>국내 종목 실적 발표일은 미리 공개되는 무료 자료가 없어서, 공시가 나오면 포트폴리오의 "확인할 것"에 표시됩니다. 미국 경제지표 발표일은 FRED 키가 있을 때 나옵니다. 배당락일은 발표된 날이 없으면 지난 배당 간격으로 짐작한 "예상"이에요.</div>
      </div>
    </>
  );
}
