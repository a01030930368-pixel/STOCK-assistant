import { query } from "@/lib/db";
import { marketOf } from "@/lib/journal";
import type { Candle } from "@/lib/candles";
import ChartGrid, { type Cell } from "./ChartGrid";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);
const MAX = 4;
const DAYS = 1500; // 칸마다 넘겨 주는 일봉(약 4년). 월봉도 볼 만큼

type Known = { ticker: string; name: string };

// 이름을 아는 종목: 보유·ISA·관심·매매한 종목·연습용 종목
async function known(): Promise<Known[]> {
  return safe(
    `SELECT DISTINCT ON (ticker) ticker, name FROM (
       SELECT ticker, name, 1 AS r FROM holdings WHERE quantity > 0
       UNION ALL SELECT ticker, name, 2 FROM isa_holdings WHERE quantity > 0
       UNION ALL SELECT ticker, name, 3 FROM watchlist
       UNION ALL SELECT ticker, NULLIF(name, ''), 4 FROM trade_fills
       UNION ALL SELECT ticker, name, 5 FROM practice_pool WHERE fetched_at IS NOT NULL AND error IS NULL) s
     WHERE name IS NOT NULL AND name <> '' ORDER BY ticker, r`,
  );
}

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ t?: string; n?: string }> }) {
  const sp = await searchParams;
  const names = await known();
  const nameOf = new Map(names.map((k) => [k.ticker, k.name]));
  let tickers = (sp.t ?? "").split(",").map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9.\-]{1,12}$/.test(t)).slice(0, MAX);
  if (!tickers.length) {
    // 처음엔 평가금액이 큰 보유 종목부터, 모자라면 관심종목으로 채워요.
    const top = await safe<{ ticker: string }>(
      `SELECT ticker FROM (SELECT ticker, eval_amount AS v, 1 AS r FROM held_all UNION ALL SELECT ticker, 0, 2 FROM watchlist) t
       GROUP BY ticker ORDER BY min(r), max(v) DESC NULLS LAST LIMIT $1`, [MAX],
    );
    tickers = top.map((r) => r.ticker);
  }
  const n = [1, 2, 4].includes(Number(sp.n)) ? Number(sp.n) : Math.min(4, Math.max(1, tickers.length >= 3 ? 4 : tickers.length));

  const cells: Cell[] = [];
  for (const ticker of tickers) {
    const rows = await safe<{ day: string; open: string | null; high: string | null; low: string | null; close: string; volume: string | null }>(
      `SELECT * FROM (SELECT to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close, volume FROM price_history WHERE ticker = $1 ORDER BY day DESC LIMIT $2) t ORDER BY day`,
      [ticker, DAYS],
    );
    const candles = rows.map<Candle>((p) => {
      const close = Number(p.close);
      return {
        day: p.day, close, volume: p.volume === null ? null : Number(p.volume),
        open: p.open === null ? close : Number(p.open), high: p.high === null ? close : Number(p.high), low: p.low === null ? close : Number(p.low),
      };
    });
    cells.push({ ticker, name: nameOf.get(ticker) ?? ticker, market: marketOf(ticker, "US"), candles });
  }

  return <ChartGrid cells={cells} layout={n as 1 | 2 | 4} options={names} fromUrl={Boolean(sp.t)} />;
}
