import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { formNumber } from "@/lib/fills";
import { loadBook } from "@/lib/booksData";
import Principles from "../../Principles";
import BuyForm from "../../buy/BuyForm";
import SellForm from "../../[id]/SellForm";

export const dynamic = "force-dynamic";

type Params = { b?: string; e?: string; buy?: string; sell?: string };
type Entry = { id: number; side: "buy" | "sell"; ticker: string; name: string; market: "KR" | "US"; values: Record<string, string> };

const plain = (v: string) => String(Number(v));

// 매수·매도 일지 한 장. 이미 쓴 일지면 그 내용을 채워서 고치게 하고, 아직이면 키움 체결로 날짜·수량·가격을 채웁니다.
async function loadEntry(side: "buy" | "sell", id: number): Promise<Entry | undefined> {
  if (side === "buy") {
    const [r] = await query<Record<string, string> & { ticker: string; name: string; market: "KR" | "US" }>(
      `SELECT b.*, to_char(b.trade_date, 'YYYY-MM-DD') AS day, p.ticker, p.name, p.market
       FROM buy_entries b JOIN positions p ON p.id = b.position_id WHERE b.id = $1`, [id]);
    if (!r) return undefined;
    return {
      id, side, ticker: r.ticker, name: r.name, market: r.market, values: {
        tradeDate: r.day, quantity: plain(r.quantity), price: formNumber(Number(r.price), r.market), reason: r.reason, scenario: r.scenario,
        risk1: r.risk_1, risk2: r.risk_2, risk3: r.risk_3, weightPct: plain(r.weight_pct), stopPrice: formNumber(Number(r.stop_price), r.market),
        targetPrice: formNumber(Number(r.target_price), r.market), targetBasis: r.target_basis,
      },
    };
  }
  const [r] = await query<Record<string, string> & { ticker: string; name: string; market: "KR" | "US"; followed_rules: boolean }>(
    `SELECT s.*, to_char(s.trade_date, 'YYYY-MM-DD') AS day, p.ticker, p.name, p.market
     FROM sell_entries s JOIN positions p ON p.id = s.position_id WHERE s.id = $1`, [id]);
  if (!r) return undefined;
  return {
    id, side, ticker: r.ticker, name: r.name, market: r.market, values: {
      tradeDate: r.day, quantity: plain(r.quantity), price: formNumber(Number(r.price), r.market), reasonType: r.reason_type,
      reasonDetail: r.reason_detail, lesson: r.lesson, followedRules: r.followed_rules ? "yes" : "no",
    },
  };
}

export default async function EntryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const bookKey = params.b ?? "";
  const book = bookKey ? await loadBook(bookKey) : undefined;
  const page = book?.pages.find((p) => p.id === params.e);
  if (bookKey && !page) notFound();

  const side = page?.side ?? (params.buy ? "buy" : params.sell ? "sell" : null);
  const id = page?.entryId ?? Number(params.buy ?? params.sell);
  if (!side) notFound();
  const entry = Number.isInteger(id) && id > 0 ? await loadEntry(side, id) : undefined;
  if (!page && !entry) notFound();

  const name = book?.name ?? entry!.name;
  const ticker = book?.ticker ?? entry!.ticker;
  const market = book?.market ?? entry!.market;
  const day = page?.day ?? entry!.values.tradeDate;
  const back = book ? `/journal/books?b=${encodeURIComponent(book.key)}` : null;

  return (
    <>
      {back && <p><Link href={back}>← {name} 일기장으로</Link></p>}
      <h1>{name} <span className="muted">{day} · {page?.label ?? (side === "buy" ? "매수" : "매도")}{entry ? " · 고치기" : ""}</span></h1>
      {!entry && page?.fillKey && (
        <div className="callout fill-note">
          키움 체결에서 날짜·수량·가격을 채웠어요. {side === "buy" ? "체크리스트만 적으면 돼요." : "이유와 배운 것만 적으면 돼요."}
        </div>
      )}
      <Principles />
      {side === "buy" ? (
        <BuyForm
          ticker={ticker} name={name} market={market} today={day}
          quantity={page ? formNumber(page.quantity, "US") : ""} price={page ? formNumber(page.price, market) : ""}
          fillKey={entry ? "" : page?.fillKey ?? ""} bookKey={book?.key} entryId={entry?.id} initial={entry?.values}
        />
      ) : (
        <SellForm
          today={day}
          quantity={page ? formNumber(page.quantity, "US") : undefined} price={page ? formNumber(page.price, market) : ""}
          fillKey={entry ? "" : page?.fillKey ?? ""} bookKey={book?.key} entryId={entry?.id} initial={entry?.values}
        />
      )}
    </>
  );
}
