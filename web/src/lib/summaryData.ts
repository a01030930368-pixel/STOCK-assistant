import { distancePct } from "./board";
import { query } from "./db";
import { summarize, type Part } from "./summary";

type Row = {
  ticker: string; market: "KR" | "US"; cur_price: string; pnl_pct: string; position_id: number | null;
  stop: string | null; target: string | null; next_earnings: string | null; days_to_earnings: number | null;
  surprise: string | null; recent_news: number;
};

// 보유 종목별 한 줄 요약. 아직 없는 테이블(예전 DB)은 비어 있는 것으로 봅니다.
export async function loadSummaries(tickers?: string[]): Promise<Map<string, Part[]>> {
  const rows = await query<Row>(
    `SELECT h.ticker, h.market, h.cur_price, h.pnl_pct, p.id AS position_id,
       (SELECT max(price) FROM alerts a WHERE a.ticker = h.ticker AND a.active AND a.kind = 'stop') AS stop,
       (SELECT min(price) FROM alerts a WHERE a.ticker = h.ticker AND a.active AND a.kind = 'target') AS target,
       (SELECT to_char(min(day), 'YYYY-MM-DD') FROM calendar_events c WHERE c.ticker = h.ticker AND c.kind = 'earnings' AND c.day >= CURRENT_DATE) AS next_earnings,
       (SELECT min(day) - CURRENT_DATE FROM calendar_events c WHERE c.ticker = h.ticker AND c.kind = 'earnings' AND c.day >= CURRENT_DATE) AS days_to_earnings,
       (SELECT e.eps_actual - e.eps_estimate FROM stock_earnings e WHERE e.ticker = h.ticker AND e.eps_actual IS NOT NULL AND e.eps_estimate IS NOT NULL
          ORDER BY e.period DESC LIMIT 1) AS surprise,
       (SELECT count(*)::int FROM stock_news n WHERE n.ticker = h.ticker AND n.published_at > now() - interval '3 days') AS recent_news
     FROM holdings h LEFT JOIN positions p ON p.ticker = h.ticker AND p.status = 'open'
     WHERE $1::text[] IS NULL OR h.ticker = ANY($1)`,
    [tickers ?? null],
  ).catch(() => [] as Row[]);
  const out = new Map<string, Part[]>();
  for (const r of rows) {
    const cur = Number(r.cur_price);
    out.set(r.ticker, summarize({
      pnlPct: Number(r.pnl_pct),
      // 매매일지가 없어도 알림만 따로 걸어 둔 종목은 손절·목표가가 있는 것으로 봅니다.
      hasJournal: r.position_id !== null || r.stop !== null || r.target !== null,
      stopDist: r.stop === null ? null : distancePct({ kind: "stop", direction: "below", price: Number(r.stop), cur }),
      targetDist: r.target === null ? null : distancePct({ kind: "target", direction: "above", price: Number(r.target), cur }),
      nextEarnings: r.next_earnings,
      daysToEarnings: r.days_to_earnings,
      lastSurprise: r.surprise === null ? null : Number(r.surprise),
      recentNews: r.recent_news,
    }));
  }
  return out;
}
