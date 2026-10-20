import Link from "next/link";
import { hideFill } from "@/app/actions";
import { query } from "@/lib/db";
import { journalHref, sideLabel, type KiwoomFill } from "@/lib/fills";
import { loadFills } from "@/lib/fillsData";
import { signClass, usd, won } from "@/lib/format";
import Principles from "./Principles";
import JournalTabs from "./JournalTabs";

export const dynamic = "force-dynamic";

type Row = { id: number; ticker: string; name: string; market: string; status: string; last_trade: string; total_return: string | null };

export default async function JournalPage() {
  const positions = await query<Row>(
    `SELECT p.id, p.ticker, p.name, p.market, p.status,
       to_char(GREATEST(MAX(b.trade_date), MAX(s.trade_date)), 'YYYY-MM-DD') AS last_trade,
       ROUND(SUM(s.return_pct * s.quantity) / NULLIF(SUM(s.quantity), 0), 2) AS total_return
     FROM positions p
     LEFT JOIN buy_entries b ON b.position_id = p.id
     LEFT JOIN sell_entries s ON s.position_id = p.id
     GROUP BY p.id ORDER BY p.status, last_trade DESC NULLS LAST`,
  );
  const list = (status: string) => positions.filter((p) => p.status === status);
  const fills = await loadFills();
  const todo = fills.filter((f) => !f.done).length;
  const SHOWN = 12;

  return (
    <>
      <div className="board-head">
        <h1>매매일지</h1>
        <JournalTabs on="list" />
      </div>
      {todo > 0 && (
        <div className="callout">키움에서 일지에 안 적은 체결 {todo}건을 찾았어요. &ldquo;일지 쓰기&rdquo;를 누르면 종목·날짜·수량·가격이 채워져 있어요.</div>
      )}
      {fills.length > 0 && (
        <section className="fills">
          <h2>최근 체결 <span className="muted">(최근 3개월, 키움)</span></h2>
          <div className="list">
            {fills.slice(0, SHOWN).map((f) => <FillRow key={f.key} f={f} />)}
          </div>
          {fills.length > SHOWN && (
            <details>
              <summary className="muted">나머지 {fills.length - SHOWN}건 보기</summary>
              <div className="list">{fills.slice(SHOWN).map((f) => <FillRow key={f.key} f={f} />)}</div>
            </details>
          )}
        </section>
      )}
      <Principles editable />
      <p><Link href="/journal/buy">+ 매수 기록하기</Link></p>
      {(["open", "closed"] as const).map((status) => (
        <section key={status}>
          <h2>{status === "open" ? "보유 중" : "청산"}</h2>
          {list(status).length === 0 && <p className="muted">없습니다.</p>}
          <div className="table-wrap">
            <table>
              <tbody>
                {list(status).map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/journal/${p.id}`}>{p.name}</Link> <span className="muted">{p.ticker} · {p.market}</span></td>
                    <td className="muted">{p.last_trade}</td>
                    <td className={`num ${signClass(p.total_return ?? 0)}`}>{p.total_return !== null ? `${p.total_return}%` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function FillRow({ f }: { f: KiwoomFill }) {
  const price = f.market === "US" ? usd(f.price) : `${won(f.price)}원`;
  const href = journalHref(f);
  return (
    <div className="list-item">
      <div className="main">
        <div className="title">{f.name} <span className={f.side === "buy" ? "up" : "down"}>{sideLabel(f.side)}</span> {won(f.quantity, 4)}주</div>
        <div className="sub num">
          {f.day.slice(5)}{f.time ? ` ${f.time}` : ""} · {f.count > 1 ? `평균 ${price} (${f.count}번 나눠 체결)` : price}
          {f.fee !== null && f.fee > 0 && ` · 수수료·세금 ${f.market === "US" ? usd(f.fee) : `${won(f.fee)}원`}`}
        </div>
      </div>
      <div className="side">
        {f.done ? (
          <span className="gold">✓ 적음</span>
        ) : href ? (
          <Link className="button soft" href={href}>일지 쓰기</Link>
        ) : (
          <span className="muted">보유 중 일지가 없어요</span>
        )}
        {!f.done && (
          <form action={hideFill}>
            <input type="hidden" name="key" value={f.key} />
            <button type="submit" className="ghost">일지 안 씀</button>
          </form>
        )}
      </div>
    </div>
  );
}
