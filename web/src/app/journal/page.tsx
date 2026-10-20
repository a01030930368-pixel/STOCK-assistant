import Link from "next/link";
import { hideFill } from "@/app/actions";
import { query } from "@/lib/db";
import { journalHref, sideLabel, type KiwoomFill } from "@/lib/fills";
import { loadFills } from "@/lib/fillsData";
import { loadBooks } from "@/lib/booksData";
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
  // 체결마다 그 체결이 들어 있는 일기장 한 장으로 갑니다. 보유 중 일지가 없는 매도도 여기서 쓸 수 있어요.
  const pageOf = new Map((await loadBooks()).flatMap((b) => b.pages.map((p) => [p.id, `/journal/books/entry?${new URLSearchParams({ b: b.key, e: p.id })}`] as const)));
  const checked = await fillStatus();
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
      <section className="fills">
        <h2>최근 체결 <span className="muted">(최근 3개월, 키움)</span></h2>
        <p className="muted fill-status">
          {checked.length === 0
            ? "아직 키움 체결을 확인하지 않았어요. 워커를 켠 뒤 몇 분 안에 처음 확인하고, 그 뒤로 30분마다 확인해요."
            : checked.map((c) => (
                <span key={c.market} className={c.ok ? "" : "warn"}>
                  {c.market === "KR" ? "국내" : "미국"} {c.at} 확인{c.ok ? (c.count !== null ? ` · ${c.count}건` : "") : ` 실패: ${c.error}`}
                </span>
              ))}
        </p>
        {fills.length > 0 && (
          <div className="list">
            {fills.slice(0, SHOWN).map((f) => <FillRow key={f.key} f={f} href={pageOf.get(f.key) ?? journalHref(f)} />)}
          </div>
        )}
        {fills.length === 0 && checked.some((c) => c.ok) && <p className="muted">최근 3개월 체결이 없어요.</p>}
        {fills.length > SHOWN && (
          <details>
            <summary className="muted">나머지 {fills.length - SHOWN}건 보기</summary>
            <div className="list">{fills.slice(SHOWN).map((f) => <FillRow key={f.key} f={f} href={pageOf.get(f.key) ?? journalHref(f)} />)}</div>
          </details>
        )}
      </section>
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

type Checked = { market: "KR" | "US"; at: string; ok: boolean; error: string; count: number | null };

// 워커가 남긴 마지막 체결 확인 결과(app_settings.fills_status). 없으면 아직 한 번도 안 돈 것
async function fillStatus(): Promise<Checked[]> {
  const [row] = await query<{ value: Record<string, { at: string; ok: boolean; error?: string; count?: number }> }>(
    "SELECT value FROM app_settings WHERE key = 'fills_status'",
  ).catch(() => []);
  const time = (iso: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  return (["KR", "US"] as const)
    .filter((m) => row?.value[m])
    .map((m) => ({ market: m, at: time(row.value[m].at), ok: row.value[m].ok, error: row.value[m].error ?? "", count: row.value[m].count ?? null }));
}

function FillRow({ f, href }: { f: KiwoomFill; href: string | null }) {
  const price = f.market === "US" ? usd(f.price) : `${won(f.price)}원`;
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
