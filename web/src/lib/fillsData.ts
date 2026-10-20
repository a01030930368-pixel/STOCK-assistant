import { query } from "./db";
import type { KiwoomFill } from "./fills";

type Row = {
  key: string; market: "KR" | "US"; day: string; time: string | null; ticker: string; name: string; side: "buy" | "sell";
  quantity: string; price: string; fee: string | null; count: number; done: boolean; position_id: number | null;
};

// 최근 3개월 키움 체결. 그 체결로 쓴 기록이 있거나, 3일 안에 쓴 같은 종목 기록이 이 체결과 가장 가까우면 '적음'으로 봅니다.
// 워커가 아직 체결 테이블을 만들기 전(예전 DB)이면 빈 목록입니다.
export async function loadFills(key?: string): Promise<KiwoomFill[]> {
  const rows = await query<Row>(
    `SELECT f.fill_key AS key, f.market, to_char(f.trade_date, 'YYYY-MM-DD') AS day, f.fill_time AS time, f.ticker,
       COALESCE(NULLIF(f.name, ''), f.ticker) AS name, f.side, f.quantity, f.price, f.fee, f.fill_count AS count,
       EXISTS (SELECT 1 FROM (
           SELECT b.fill_key, b.trade_date, p.ticker, p.market FROM buy_entries b JOIN positions p ON p.id = b.position_id WHERE f.side = 'buy'
           UNION ALL
           SELECT s.fill_key, s.trade_date, p.ticker, p.market FROM sell_entries s JOIN positions p ON p.id = s.position_id WHERE f.side = 'sell'
         ) e
         WHERE e.fill_key = f.fill_key OR (e.fill_key IS NULL AND e.ticker = f.ticker AND e.market = f.market
           AND abs(e.trade_date - f.trade_date) <= 3
           -- 일기장과 같은 규칙: 일지에서 가장 가까운 체결 하나만 '적음'
           AND NOT EXISTS (SELECT 1 FROM trade_fills g WHERE g.ticker = f.ticker AND g.market = f.market AND g.side = f.side
             AND g.fill_key <> f.fill_key AND abs(g.trade_date - e.trade_date) < abs(f.trade_date - e.trade_date)))) AS done,
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
