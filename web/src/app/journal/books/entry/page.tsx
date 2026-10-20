import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { formNumber } from "@/lib/fills";
import { loadBook } from "@/lib/booksData";
import Principles from "../../Principles";
import BuyForm from "../../buy/BuyForm";
import SellForm from "../../[id]/SellForm";
import BuyChartShot, { type ShotBar } from "@/app/_components/BuyChartShot";
import MacroCard, { SNAPSHOT_COLUMNS, type Snapshot } from "@/app/macro/MacroCard";
import { fixedPct, usd, won } from "@/lib/format";
import { rateGap } from "@/lib/macro";

export const dynamic = "force-dynamic";

type Params = { b?: string; e?: string; buy?: string; sell?: string; edit?: string };
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

  // 이미 쓴 일지는 먼저 읽기로 보여 주고, 고치기 버튼을 눌러야 고칠 수 있어요.
  if (entry && params.edit !== "1") {
    const editHref = `/journal/books/entry?${new URLSearchParams({ ...params, edit: "1" } as Record<string, string>)}`;
    return (
      <>
        {back && <p><Link href={back}>← {name} 일기장으로</Link></p>}
        <div className="entry-head">
          <h1>{name} <span className="muted">{day} · {page?.label ?? (side === "buy" ? "매수" : "매도")}</span></h1>
          <Link className="button" href={editHref}>고치기</Link>
        </div>
        {side === "buy" ? <BuyView id={entry.id} market={market} ticker={ticker} /> : <SellView id={entry.id} market={market} />}
      </>
    );
  }

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

const MACRO_ROWS: [string, string][] = [
  ["kr_base_rate", "한국 기준금리"], ["us_base_rate", "미국 기준금리"], ["usdkrw", "원/달러"], ["kr_cpi_yoy", "한국 물가"], ["us_cpi_yoy", "미국 물가"],
];
type Context = { macro?: Record<string, { value: string; as_of: string }> } | null;

function MacroThen({ context, day }: { context: Context; day: string }) {
  if (!context) return <p className="muted">워커가 {day} 기준 매크로를 받아 오는 중이에요. 몇 분 뒤 다시 열면 보여요.</p>;
  const m = context.macro ?? {};
  if (!Object.keys(m).length) return <p className="muted">그날 매크로를 못 받았어요. .env에 ECOS·FRED 키가 있어야 해요.</p>;
  const v = (k: string) => m[k]?.value ?? null;
  const gap = rateGap(v("kr_base_rate"), v("us_base_rate"));
  const show = (k: string) => k === "usdkrw" ? (v(k) ? Number(v(k)).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-") : fixedPct(v(k));
  return (
    <dl className="entry-macro">
      {MACRO_ROWS.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{show(k)}</dd></div>)}
      <div><dt>금리차</dt><dd>{gap === null ? "-" : `${gap > 0 ? "+" : ""}${gap.toFixed(2)}%p`}</dd></div>
    </dl>
  );
}

type BuyRow = {
  day: string; quantity: string; price: string; reason: string; scenario: string; risk_1: string; risk_2: string; risk_3: string;
  weight_pct: string; stop_price: string; target_price: string; target_basis: string; macro_snapshot_id: number | null;
  context: Context; chart_png: string | null;
};

async function BuyView({ id, market, ticker }: { id: number; market: "KR" | "US"; ticker: string }) {
  const [r] = await query<BuyRow>(
    `SELECT b.*, to_char(b.trade_date, 'YYYY-MM-DD') AS day FROM buy_entries b WHERE b.id = $1`, [id]);
  if (!r) notFound();
  const money = (v: string | number) => (market === "US" ? usd(v) : `${won(v)}원`);
  const bars = r.chart_png ? [] : (await query<{ day: string; open: string | null; high: string | null; low: string | null; close: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close FROM price_history
     WHERE ticker = $1 AND day <= $2 AND day > $2::date - 180 ORDER BY day`, [ticker, r.day])).map((b): ShotBar => {
    const c = Number(b.close);
    return { day: b.day, open: Number(b.open ?? c), high: Number(b.high ?? c), low: Number(b.low ?? c), close: c };
  });
  const [memo] = r.macro_snapshot_id
    ? await query<Snapshot>(`SELECT ${SNAPSHOT_COLUMNS} FROM macro_snapshots WHERE id = $1`, [r.macro_snapshot_id])
    : [];
  return (
    <div className="entry-view">
      <div className="stats">
        <div className="stat"><div className="stat-label">산 것</div><div className="stat-value">{Number(r.quantity)}주</div><div className="stat-sub">{money(r.price)}</div></div>
        <div className="stat"><div className="stat-label">비중</div><div className="stat-value">{Number(r.weight_pct)}%</div><div className="stat-sub">자산 대비</div></div>
        <div className="stat"><div className="stat-label">손절</div><div className="stat-value down">{money(r.stop_price)}</div><div className="stat-sub">{fixedPct((Number(r.stop_price) / Number(r.price) - 1) * 100, 1)}</div></div>
        <div className="stat"><div className="stat-label">익절</div><div className="stat-value up">{money(r.target_price)}</div><div className="stat-sub">{r.target_basis === "chart" ? "차트 분석" : "퍼센트"} · +{fixedPct((Number(r.target_price) / Number(r.price) - 1) * 100, 1)}</div></div>
      </div>
      <section className="panel">
        <div className="panel-title">왜 샀나</div>
        <p className="entry-text">{r.reason}</p>
        <div className="panel-title">가장 큰 리스크</div>
        <ol className="entry-risks"><li>{r.risk_1}</li><li>{r.risk_2}</li><li>{r.risk_3}</li></ol>
        {r.scenario && <><div className="panel-title">기대 시나리오</div><p className="entry-text">{r.scenario}</p></>}
      </section>
      <section className="panel">
        <div className="panel-title">그때 차트 <span className="muted">{r.day}까지 일봉</span></div>
        <BuyChartShot entryId={id} bars={bars} buyDay={r.day} buyPrice={Number(r.price)} stop={Number(r.stop_price)}
          target={Number(r.target_price)} saved={r.chart_png} />
      </section>
      <section className="panel">
        <div className="panel-title">그때 매크로 <span className="muted">{r.day} 기준</span></div>
        <MacroThen context={r.context} day={r.day} />
      </section>
      {memo && <MacroCard s={memo} title={`그때 쓴 매크로 메모 (${memo.snapshot_day})`} />}
    </div>
  );
}

const SELL_REASON: Record<string, string> = { stop: "손절", target: "익절", other: "다른 사유" };

async function SellView({ id, market }: { id: number; market: "KR" | "US" }) {
  const [r] = await query<{ day: string; quantity: string; price: string; return_pct: string | null; holding_days: number;
    reason_type: string; reason_detail: string; lesson: string; followed_rules: boolean }>(
    "SELECT s.*, to_char(s.trade_date, 'YYYY-MM-DD') AS day FROM sell_entries s WHERE s.id = $1", [id]);
  if (!r) notFound();
  const money = (v: string | number) => (market === "US" ? usd(v) : `${won(v)}원`);
  return (
    <div className="entry-view">
      <div className="stats">
        <div className="stat"><div className="stat-label">판 것</div><div className="stat-value">{Number(r.quantity)}주</div><div className="stat-sub">{money(r.price)}</div></div>
        <div className="stat"><div className="stat-label">수익률</div><div className="stat-value">{r.return_pct === null ? "-" : fixedPct(r.return_pct)}</div><div className="stat-sub">보유 {r.holding_days}일</div></div>
        <div className="stat"><div className="stat-label">이유</div><div className="stat-value">{SELL_REASON[r.reason_type] ?? "-"}</div><div className="stat-sub">{r.followed_rules ? "원칙 지킴" : "원칙 못 지킴"}</div></div>
      </div>
      <section className="panel">
        {r.reason_detail && <><div className="panel-title">판 이유</div><p className="entry-text">{r.reason_detail}</p></>}
        <div className="panel-title">배운 것</div>
        <p className="entry-text">{r.lesson || "-"}</p>
      </section>
    </div>
  );
}
