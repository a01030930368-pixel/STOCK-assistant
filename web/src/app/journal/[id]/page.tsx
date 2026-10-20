import Link from "next/link";
import { notFound } from "next/navigation";
import { saveNotes } from "@/app/actions";
import { query } from "@/lib/db";
import { signClass, today, usd, won } from "@/lib/format";
import MacroCard, { SNAPSHOT_COLUMNS, type Snapshot } from "@/app/macro/MacroCard";
import Principles from "../Principles";
import SellForm from "./SellForm";
import { formNumber } from "@/lib/fills";
import { loadFills } from "@/lib/fillsData";

export const dynamic = "force-dynamic";

type Position = { id: number; ticker: string; name: string; market: string; status: string; notes: string };
type Buy = {
  id: number; trade_day: string; quantity: string; price: string; reason: string; scenario: string;
  risk_1: string; risk_2: string; risk_3: string; weight_pct: string; stop_price: string; target_price: string; target_basis: string;
  macro_snapshot_id: number | null;
};
type Sell = {
  id: number; trade_day: string; quantity: string; price: string; return_pct: string | null; holding_days: number;
  reason_type: string; reason_detail: string; lesson: string; followed_rules: boolean;
  macro_snapshot_id: number | null;
};
type Alert = { id: number; kind: string; price: string; active: boolean; triggered_at: Date | null };

const REASON = { stop: "손절", target: "익절", other: "다른 사유" } as Record<string, string>;

export default async function PositionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const id = Number((await params).id);
  const fillKey = (await searchParams).fill;
  if (!Number.isInteger(id)) notFound();
  const [position] = await query<Position>("SELECT * FROM positions WHERE id = $1", [id]);
  if (!position) notFound();
  const date = "to_char(trade_date, 'YYYY-MM-DD') AS trade_day";
  const buys = await query<Buy>(`SELECT *, ${date} FROM buy_entries WHERE position_id = $1 ORDER BY trade_date, id`, [id]);
  const sells = await query<Sell>(`SELECT *, ${date} FROM sell_entries WHERE position_id = $1 ORDER BY trade_date, id`, [id]);
  const alerts = await query<Alert>("SELECT id, kind, price, active, triggered_at FROM alerts WHERE position_id = $1 ORDER BY id DESC LIMIT 4", [id]);
  const snapshotIds = [...buys, ...sells].map((e) => e.macro_snapshot_id).filter((v): v is number => v !== null);
  const snapshots = new Map(
    (await query<Snapshot>(`SELECT ${SNAPSHOT_COLUMNS} FROM macro_snapshots WHERE id = ANY($1)`, [snapshotIds])).map((s) => [s.id, s]),
  );
  const macroOf = (id: number | null) => {
    const s = id === null ? undefined : snapshots.get(id);
    return s && <MacroCard s={s} title={`당시 매크로 (${s.snapshot_day} 메모)`} />;
  };
  const remaining = Math.round((buys.reduce((s, b) => s + Number(b.quantity), 0) - sells.reduce((s, x) => s + Number(x.quantity), 0)) * 1e6) / 1e6;
  // 미국 주식은 달러로, 국내는 원으로 보여 줍니다.
  const money = (v: string | number) => (position.market === "US" ? usd(v) : `${won(v)}원`);
  const [fill] = fillKey ? (await loadFills(fillKey)).filter((f) => f.side === "sell" && f.ticker === position.ticker && !f.done) : [];

  return (
    <>
      <h1>{position.name} <span className="muted">{position.ticker} · {position.market} · {position.status === "open" ? "보유 중" : "청산"}</span></h1>
      <p><Link href={`/stock/${encodeURIComponent(position.ticker)}`}>뉴스·실적·재무 보기</Link></p>
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
          <strong>{b.trade_day}</strong> · {won(b.quantity, 4)}주 @ {money(b.price)} · 비중 {b.weight_pct}% · <Link href={`/journal/books/entry?buy=${b.id}`}>보기</Link> · <Link href={`/journal/books/entry?buy=${b.id}&edit=1`}>고치기</Link>
          <div>매수 이유: {b.reason}</div>
          {b.scenario && <div>기대 시나리오: {b.scenario}</div>}
          <div>주요 리스크: {b.risk_1} / {b.risk_2} / {b.risk_3}</div>
          <div>손절 {money(b.stop_price)} · 익절 {money(b.target_price)} ({b.target_basis === "chart" ? "차트 분석" : "퍼센트"})</div>
          {macroOf(b.macro_snapshot_id)}
        </div>
      ))}
      {position.status === "open" && <p><Link href={`/journal/buy?${new URLSearchParams({ ticker: position.ticker, name: position.name, market: position.market })}`}>+ 추가 매수 기록</Link></p>}

      <h2>알림</h2>
      {alerts.map((a) => (
        <div key={a.id} className="muted">
          {a.kind === "stop" ? "손절" : a.kind === "target" ? "익절" : "알림"} {money(a.price)} ·{" "}
          {a.active ? "대기 중" : a.triggered_at ? `발송됨 ${a.triggered_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : "꺼짐"}
        </div>
      ))}

      <h2>매도 기록</h2>
      {sells.length === 0 && <p className="muted">없습니다.</p>}
      {sells.map((s) => (
        <div className="card" key={s.id}>
          <strong>{s.trade_day}</strong> · {won(s.quantity, 4)}주 @ {money(s.price)} ·{" "}
          {s.return_pct === null ? <span className="muted">수익률 모름</span> : <span className={signClass(s.return_pct)}>{s.return_pct}%</span>} · 보유 {s.holding_days}일 · <Link href={`/journal/books/entry?sell=${s.id}`}>보기</Link> · <Link href={`/journal/books/entry?sell=${s.id}&edit=1`}>고치기</Link>
          <div>매도 이유: {REASON[s.reason_type]}{s.reason_detail && ` (${s.reason_detail})`}</div>
          <div>배운 것: {s.lesson}</div>
          <div>원칙 준수: {s.followed_rules ? "지켰다" : "못 지켰다"}</div>
          {macroOf(s.macro_snapshot_id)}
        </div>
      ))}
      {position.status === "open" && remaining > 0 && (
        <>
          <h2 id="sell">매도 기록하기</h2>
          {fill && <div className="callout fill-note">키움 체결에서 매도일·수량·가격을 채웠어요. 이유와 배운 것만 적으면 돼요.</div>}
          <SellForm
            positionId={id}
            remaining={remaining}
            today={fill?.day ?? today()}
            quantity={fill ? formNumber(Math.min(fill.quantity, remaining), "US") : undefined}
            price={fill ? formNumber(fill.price, fill.market) : ""}
            fillKey={fill?.key ?? ""}
          />
        </>
      )}
    </>
  );
}
