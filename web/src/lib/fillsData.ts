import { query } from "./db";
import type { KiwoomFill } from "./fills";

type Row = {
  key: string; market: "KR" | "US"; day: string; time: string | null; ticker: string; name: string; side: "buy" | "sell";
  quantity: string; price: string; fee: string | null; count: number; done: boolean; position_id: number | null;
};

// 최근 3개월 키움 체결. 같은 날 같은 종목 기록이 이미 있거나 그 체결로 쓴 기록이 있으면 '적음'으로 봅니다.
// 워커가 아직 체결 테이블을 만들기 전(예전 DB)이면 빈 목록입니다.
export async function loadFills(key?: string): Promise<KiwoomFill[]> {
  const rows = await query<Row>(
    `SELECT f.fill_key AS key, f.market, to_char(f.trade_date, 'YYYY-MM-DD') AS day, f.fill_time AS time, f.ticker,
       COALESCE(NULLIF(f.name, ''), f.ticker) AS name, f.side, f.quantity, f.price, f.fee, f.fill_count AS count,
       CASE WHEN f.side = 'buy' THEN EXISTS (
         SELECT 1 FROM buy_entries b JOIN positions p ON p.id = b.position_id
         WHERE b.fill_key = f.fill_key OR (p.ticker = f.ticker AND b.trade_date = f.trade_date))
       ELSE EXISTS (
         SELECT 1 FROM sell_entries s JOIN positions p ON p.id = s.position_id
         WHERE s.fill_key = f.fill_key OR (p.ticker = f.ticker AND s.trade_date = f.trade_date)) END AS done,
       (SELECT p.id FROM positions p WHERE p.ticker = f.ticker AND p.status = 'open' ORDER BY p.id LIMIT 1) AS position_id
     FROM trade_fills f
     WHERE ${key ? "f.fill_key = $1" : "NOT f.hidden AND f.trade_date >= CURRENT_DATE - 92"}
     ORDER BY f.trade_date DESC, f.fill_time DESC NULLS LAST, f.ticker`,
    key ? [key] : [],
  ).catch(() => [] as Row[]);
  return rows.map((r) => ({
    key: r.key, market: r.market, day: r.day, time: r.time, ticker: r.ticker, name: r.name, side: r.side,
    quantity: Number(r.quantity), price: Number(r.price), fee: r.fee === null ? null : Number(r.fee), count: r.count,
    done: r.done, positionId: r.position_id,
  }));
}
