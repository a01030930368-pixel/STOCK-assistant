import { query } from "./db";
import { attachEntries, buildBooks, findBook, isBookSort, type Book, type BookSort, type EntryRow, type FillRow, type Holding, type Market } from "./books";
import { today } from "./format";
import { marketOf } from "./journal";

type HoldingRow = { market: Market; ticker: string; name: string; quantity: string; avg_price: string; pnl_pct: string | null };

// 키움 체결 전부(숨긴 것 포함, 수량을 맞추려면 다 있어야 해요)에 그날 적은 일지를 붙이고,
// 체결이 없는 일지(손으로만 적은 매매)는 따로 한 장으로 넣습니다.
export async function loadBooks(): Promise<Book[]> {
  const fills = await query<FillRow>(
    `SELECT fill_key AS key, market, to_char(trade_date, 'YYYY-MM-DD') AS day, fill_time AS time, ticker,
       COALESCE(NULLIF(name, ''), ticker) AS name, side, quantity, price, fee, hidden
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

  // 미국 종목을 국내로 적은 예전 일지도 체결과 같은 권에 묶이게 티커 모양으로 시장을 맞춥니다.
  for (const e of entries) e.market = marketOf(e.ticker, e.market);
  const events = attachEntries(fills, entries);
  const used = new Set(events.flatMap((e) => e.entryIds));
  for (const e of entries) {
    if (used.has(`${e.side}:${e.id}`)) continue;
    events.push({
      id: `${e.side}:${e.id}`, market: e.market, ticker: e.ticker, name: e.name, day: e.day, time: null, side: e.side,
      quantity: Number(e.quantity), price: Number(e.price), fee: null, fillKey: null, entryId: e.id, note: e.note, entryIds: [],
    });
  }
  const books = buildBooks(events.map(({ entryIds: _, ...e }) => e), holdings.map((h): Holding => ({
    market: h.market, ticker: h.ticker, name: h.name, quantity: Number(h.quantity), avgPrice: Number(h.avg_price),
    pnlPct: h.pnl_pct === null ? null : Number(h.pnl_pct),
  })), today());
  await settlePositions(books);
  return books;
}

export async function loadBook(key: string): Promise<Book | undefined> {
  return findBook(await loadBooks(), key);
}

// 일기장에서 쓴 일지 묶음(positions.book_key)을 지금 권에 맞춥니다.
// 보유 중일 때 키가 '…:open'이라, 다 판 뒤에는 끝난 권 키로 옮기고 보유 중 표시와 손절·익절 알림을 끕니다.
// 다시 사서 새 권이 열렸는데 옛 묶음이 그대로면, 옛 일지가 새 권에 섞이지 않게 옛 권으로 옮겨요.
async function settlePositions(books: Book[]): Promise<void> {
  const rows = await query<{ id: number; book_key: string; first_day: string | null }>(
    `SELECT p.id, p.book_key, to_char(LEAST(
        (SELECT min(trade_date) FROM buy_entries b WHERE b.position_id = p.id),
        (SELECT min(trade_date) FROM sell_entries s WHERE s.position_id = p.id)), 'YYYY-MM-DD') AS first_day
     FROM positions p WHERE p.book_key LIKE '%:open'`,
  ).catch(() => []);
  for (const row of rows) {
    const stock = row.book_key.slice(0, -":open".length);
    const mine = books.filter((b) => `${b.market}:${b.ticker}` === stock);
    const open = mine.find((b) => !b.end);
    if (open && (!open.start || !row.first_day || row.first_day >= open.start)) continue;
    const closed = mine.filter((b) => b.end && (!open?.start || b.end <= open.start)).sort((a, b) => (a.end! < b.end! ? -1 : 1));
    const target = (row.first_day && closed.find((b) => b.end! >= row.first_day!)) || closed.at(-1);
    if (!target) continue;
    await moveToBook(row.id, target);
  }
}

async function moveToBook(positionId: number, book: Book): Promise<void> {
  await query("UPDATE alerts SET active = false WHERE position_id = $1 AND kind IN ('stop', 'target') AND active", [positionId]);
  const [other] = await query<{ id: number }>("SELECT id FROM positions WHERE book_key = $1 AND id <> $2 LIMIT 1", [book.key, positionId]);
  if (other) {
    // 끝난 권에 매도 일지를 쓰며 이미 묶음이 따로 생겼으면 하나로 합칩니다.
    await query("UPDATE buy_entries SET position_id = $1 WHERE position_id = $2", [other.id, positionId]);
    await query("UPDATE sell_entries SET position_id = $1 WHERE position_id = $2", [other.id, positionId]);
    await query("UPDATE alerts SET position_id = $1 WHERE position_id = $2", [other.id, positionId]);
    await query(
      "UPDATE positions SET notes = trim(both E'\\n' FROM notes || E'\\n' || (SELECT notes FROM positions WHERE id = $2)) WHERE id = $1",
      [other.id, positionId]);
    await query("DELETE FROM positions WHERE id = $1", [positionId]);
    await query("UPDATE positions SET status = 'closed', closed_at = COALESCE(closed_at, $2::date) WHERE id = $1", [other.id, book.end]);
  } else {
    await query("UPDATE positions SET book_key = $2, status = 'closed', closed_at = COALESCE(closed_at, $3::date) WHERE id = $1",
      [positionId, book.key, book.end]);
  }
}

export type Review = { stars: number | null; followed_rules: boolean | null; thesis: string; plan: string; exit_timing: string; lesson: string; updated: string; edited: string };

export async function loadReviews(): Promise<Map<string, Review>> {
  const rows = await query<Review & { book_key: string }>(
    `SELECT book_key, stars, followed_rules, thesis, plan, exit_timing, lesson, to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS updated,
       to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') AS edited
     FROM book_reviews`,
  ).catch(() => []);
  return new Map(rows.map((r) => [r.book_key, r]));
}

// 일지(매수·매도)를 쓰거나 고친 때. 키는 "buy:12"처럼 종류:번호예요.
export async function loadEdits(): Promise<Map<string, string>> {
  const rows = await query<{ key: string; at: string }>(
    `SELECT 'buy:' || id AS key, to_char(GREATEST(created_at, updated_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM buy_entries
     UNION ALL
     SELECT 'sell:' || id, to_char(GREATEST(created_at, updated_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') FROM sell_entries`,
  ).catch(() => []);
  return new Map(rows.map((r) => [r.key, r.at]));
}

// 책장 정렬: 한 번 고르면 다시 고를 때까지 그대로(폰·PC 같이)
export async function loadBookSort(): Promise<BookSort> {
  const [row] = await query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = 'books_sort'").catch(() => []);
  return isBookSort(row?.value) ? row.value : "recent";
}

export async function saveBookSort(sort: BookSort): Promise<void> {
  await query(
    "INSERT INTO app_settings (key, value) VALUES ('books_sort', to_jsonb($1::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [sort],
  );
}

type BuyPlan = { id: number; reason: string; scenario: string; stop_price: string; target_price: string };

// 사후강평 질문 옆에 보여 줄 매수 때 기록(이유·손절·익절)
export async function buyPlans(ids: number[]): Promise<Map<number, BuyPlan>> {
  if (!ids.length) return new Map();
  const rows = await query<BuyPlan>("SELECT id, reason, scenario, stop_price, target_price FROM buy_entries WHERE id = ANY($1)", [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}
