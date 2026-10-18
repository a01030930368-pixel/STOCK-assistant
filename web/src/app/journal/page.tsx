import Link from "next/link";
import { query } from "@/lib/db";
import { signClass } from "@/lib/format";
import Principles from "./Principles";

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

  return (
    <>
      <h1>매매일지</h1>
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
