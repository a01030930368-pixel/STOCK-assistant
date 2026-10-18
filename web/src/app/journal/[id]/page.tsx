import Link from "next/link";
import { notFound } from "next/navigation";
import { saveNotes } from "@/app/actions";
import { query } from "@/lib/db";
import { signClass, today, won } from "@/lib/format";
import Principles from "../Principles";
import SellForm from "./SellForm";

export const dynamic = "force-dynamic";

type Position = { id: number; ticker: string; name: string; market: string; status: string; notes: string };
type Buy = {
  id: number; trade_day: string; quantity: string; price: string; reason: string; scenario: string;
  risk_1: string; risk_2: string; risk_3: string; weight_pct: string; stop_price: string; target_price: string; target_basis: string;
};
type Sell = {
  id: number; trade_day: string; quantity: string; price: string; return_pct: string; holding_days: number;
  reason_type: string; reason_detail: string; lesson: string; followed_rules: boolean;
};
type Alert = { id: number; kind: string; price: string; active: boolean; triggered_at: Date | null };

const REASON = { stop: "손절", target: "익절", other: "다른 사유" } as Record<string, string>;

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [position] = await query<Position>("SELECT * FROM positions WHERE id = $1", [id]);
  if (!position) notFound();
  const date = "to_char(trade_date, 'YYYY-MM-DD') AS trade_day";
  const buys = await query<Buy>(`SELECT *, ${date} FROM buy_entries WHERE position_id = $1 ORDER BY trade_date, id`, [id]);
  const sells = await query<Sell>(`SELECT *, ${date} FROM sell_entries WHERE position_id = $1 ORDER BY trade_date, id`, [id]);
  const alerts = await query<Alert>("SELECT id, kind, price, active, triggered_at FROM alerts WHERE position_id = $1 ORDER BY id DESC LIMIT 4", [id]);
  const remaining = buys.reduce((s, b) => s + Number(b.quantity), 0) - sells.reduce((s, x) => s + Number(x.quantity), 0);

  return (
    <>
      <h1>{position.name} <span className="muted">{position.ticker} · {position.market} · {position.status === "open" ? "보유 중" : "청산"}</span></h1>
      <Principles />

      <h2>내 생각</h2>
      <form action={saveNotes} className="stack">
        <input type="hidden" name="positionId" value={id} />
        <textarea name="notes" defaultValue={position.notes} placeholder="이 종목에 대한 생각을 자유롭게 적어 두세요" />
        <button type="submit">메모 저장</button>
      </form>

      <h2>매수 기록</h2>
      {buys.map((b) => (
        <div className="card" key={b.id}>
          <strong>{b.trade_day}</strong> · {won(b.quantity, 4)}주 @ {won(b.price, 2)} · 비중 {b.weight_pct}%
          <div>매수 이유: {b.reason}</div>
          {b.scenario && <div>기대 시나리오: {b.scenario}</div>}
          <div>주요 리스크: {b.risk_1} / {b.risk_2} / {b.risk_3}</div>
          <div>손절 {won(b.stop_price, 2)} · 익절 {won(b.target_price, 2)} ({b.target_basis === "chart" ? "차트 분석" : "퍼센트"})</div>
        </div>
      ))}
      {position.status === "open" && <p><Link href={`/journal/buy?${new URLSearchParams({ ticker: position.ticker, name: position.name, market: position.market })}`}>+ 추가 매수 기록</Link></p>}

      <h2>알림</h2>
      {alerts.map((a) => (
        <div key={a.id} className="muted">
          {a.kind === "stop" ? "손절" : a.kind === "target" ? "익절" : "알림"} {won(a.price, 2)} ·{" "}
          {a.active ? "대기 중" : a.triggered_at ? `발송됨 ${a.triggered_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : "꺼짐"}
        </div>
      ))}

      <h2>매도 기록</h2>
      {sells.length === 0 && <p className="muted">없습니다.</p>}
      {sells.map((s) => (
        <div className="card" key={s.id}>
          <strong>{s.trade_day}</strong> · {won(s.quantity, 4)}주 @ {won(s.price, 2)} ·{" "}
          <span className={signClass(s.return_pct)}>{s.return_pct}%</span> · 보유 {s.holding_days}일
          <div>매도 이유: {REASON[s.reason_type]}{s.reason_detail && ` (${s.reason_detail})`}</div>
          <div>배운 것: {s.lesson}</div>
          <div>원칙 준수: {s.followed_rules ? "지켰다" : "못 지켰다"}</div>
        </div>
      ))}
      {position.status === "open" && remaining > 0 && (
        <>
          <h2>매도 기록하기</h2>
          <SellForm positionId={id} remaining={remaining} today={today()} />
        </>
      )}
    </>
  );
}
