import { query } from "./db";
import { buildBooks, type Book, type BookEvent, type Holding, type Market, type Side } from "./books";
import { today } from "./format";

type FillRow = {
  key: string; market: Market; day: string; time: string | null; ticker: string; name: string; side: Side;
  quantity: string; price: string; fee: string | null;
};
type EntryRow = { id: number; side: Side; fill_key: string | null; market: Market; ticker: string; name: string; day: string; quantity: string; price: string; note: string };
type HoldingRow = { market: Market; ticker: string; name: string; quantity: string; avg_price: string; pnl_pct: string | null };

// 키움 체결 전부(숨긴 것 포함, 수량을 맞추려면 다 있어야 해요)에 그날 적은 일지를 붙이고,
// 체결이 없는 일지(손으로만 적은 매매)는 따로 한 장으로 넣습니다.
export async function loadBooks(): Promise<Book[]> {
  const fills = await query<FillRow>(
    `SELECT fill_key AS key, market, to_char(trade_date, 'YYYY-MM-DD') AS day, fill_time AS time, ticker,
       COALESCE(NULLIF(name, ''), ticker) AS name, side, quantity, price, fee
     FROM trade_fills ORDER BY trade_date, fill_time NULLS LAST`,
  ).catch(() => [] as FillRow[]);
  const entries = await query<EntryRow>(
    `SELECT b.id, 'buy' AS side, b.fill_key, p.market, p.ticker, p.name, to_char(b.trade_date, 'YYYY-MM-DD') AS day, b.quantity, b.price, b.reason AS note
       FROM buy_entries b JOIN positions p ON p.id = b.position_id
     UNION ALL
     SELECT s.id, 'sell', s.fill_key, p.market, p.ticker, p.name, to_char(s.trade_date, 'YYYY-MM-DD'), s.quantity, s.price, s.lesson
       FROM sell_entries s JOIN positions p ON p.id = s.position_id
     ORDER BY 1`,
  );
  const holdings = await query<HoldingRow>("SELECT market, ticker, name, quantity, avg_price, pnl_pct FROM holdings");

  const used = new Set<string>();
  const take = (pred: (e: EntryRow) => boolean) => {
    const e = entries.find((x) => !used.has(`${x.side}:${x.id}`) && pred(x));
    if (e) used.add(`${e.side}:${e.id}`);
    return e;
  };
  const events: BookEvent[] = fills.map((f) => {
    const e = take((x) => x.fill_key === f.key) ?? take((x) => !x.fill_key && x.side === f.side && x.ticker === f.ticker && x.day === f.day);
    return {
      id: f.key, market: f.market, ticker: f.ticker, name: f.name, day: f.day, time: f.time, side: f.side,
      quantity: Number(f.quantity), price: Number(f.price), fee: f.fee === null ? null : Number(f.fee),
      fillKey: f.key, entryId: e?.id ?? null, note: e?.note ?? null,
    };
  });
  for (const e of entries) {
    if (used.has(`${e.side}:${e.id}`)) continue;
    events.push({
      id: `${e.side}:${e.id}`, market: e.market, ticker: e.ticker, name: e.name, day: e.day, time: null, side: e.side,
      quantity: Number(e.quantity), price: Number(e.price), fee: null, fillKey: null, entryId: e.id, note: e.note,
    });
  }
  return buildBooks(events, holdings.map((h): Holding => ({
    market: h.market, ticker: h.ticker, name: h.name, quantity: Number(h.quantity), avgPrice: Number(h.avg_price),
    pnlPct: h.pnl_pct === null ? null : Number(h.pnl_pct),
  })), today());
}

export async function loadBook(key: string): Promise<Book | undefined> {
  return (await loadBooks()).find((b) => b.key === key);
}

export type Review = { stars: number | null; followed_rules: boolean | null; thesis: string; plan: string; exit_timing: string; lesson: string; updated: string };

export async function loadReviews(): Promise<Map<string, Review>> {
  const rows = await query<Review & { book_key: string }>(
    `SELECT book_key, stars, followed_rules, thesis, plan, exit_timing, lesson, to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS updated
     FROM book_reviews`,
  ).catch(() => []);
  return new Map(rows.map((r) => [r.book_key, r]));
}

type BuyPlan = { id: number; reason: string; scenario: string; stop_price: string; target_price: string };

// 사후강평 질문 옆에 보여 줄 매수 때 기록(이유·손절·익절)
export async function buyPlans(ids: number[]): Promise<Map<number, BuyPlan>> {
  if (!ids.length) return new Map();
  const rows = await query<BuyPlan>("SELECT id, reason, scenario, stop_price, target_price FROM buy_entries WHERE id = ANY($1)", [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}
