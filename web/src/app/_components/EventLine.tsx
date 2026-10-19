import Link from "next/link";
import { asOf } from "@/lib/format";

export type CalendarEvent = { day: string; kind: "holiday" | "earnings" | "policy" | "economic"; market: "KR" | "US"; ticker: string; title: string; detail: string };

export const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY = (day: string) => WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()];

// 일정 한 줄(이름, 날짜, 세부). 포트폴리오와 일정 화면에서 같이 씁니다.
export default function EventLine({ e }: { e: CalendarEvent }) {
  return (
    <li>
      <div className="row2">
        {e.ticker ? <Link href={`/stock/${encodeURIComponent(e.ticker)}`}>{e.title}</Link> : <span>{e.title}</span>}
        <span className={`badge ${e.kind === "earnings" ? "gold" : e.kind === "policy" || e.kind === "economic" ? "macro" : ""}`}>{asOf(e.day).slice(5)} ({WEEKDAY(e.day)})</span>
      </div>
      {e.detail && <div className="meta">{e.detail}</div>}
    </li>
  );
}
