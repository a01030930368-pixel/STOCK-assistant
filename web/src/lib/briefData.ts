// 한 장 요약에 넣을 자료를 DB에서 모아요. 표가 아직 없는 예전 DB에서는 빈 자료로 계산해요.
import { query } from "./db";
import type { BriefInput } from "./brief";
import type { Candle } from "./candles";
import type { Report } from "./earnings";
import type { FlowRow } from "./flows";
import type { StatementRow } from "./statements";

const safe = <T,>(sql: string, params: unknown[]) => query<T>(sql, params).catch(() => [] as T[]);

export async function loadBriefInput(ticker: string, market: "KR" | "US"): Promise<BriefInput> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: market === "US" ? "America/New_York" : "Asia/Seoul" });
  const [priceRow] = await safe<{ cur: string | null }>(
    `SELECT COALESCE((SELECT cur_price FROM holdings WHERE ticker = $1), (SELECT price FROM watch_quotes WHERE ticker = $1),
              (SELECT close FROM price_history WHERE ticker = $1 ORDER BY day DESC LIMIT 1)) AS cur`, [ticker],
  );
  const candles = (await safe<{ day: string; open: string | null; high: string | null; low: string | null; close: string; volume: string | null }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close, volume FROM price_history WHERE ticker = $1 ORDER BY day", [ticker],
  )).map<Candle>((p) => {
    const close = Number(p.close);
    return { day: p.day, close, volume: p.volume === null ? null : Number(p.volume), open: p.open === null ? close : Number(p.open), high: p.high === null ? close : Number(p.high), low: p.low === null ? close : Number(p.low) };
  });
  const statements = (await safe<{ kind: StatementRow["kind"]; period: string; item: string; value: string }>(
    "SELECT kind, period, item, value FROM stock_statements WHERE ticker = $1", [ticker],
  )).map<StatementRow>((r) => ({ kind: r.kind, period: r.period, item: r.item, value: Number(r.value) }));
  const [shareRow] = await safe<{ shares: string }>("SELECT shares FROM stock_shares WHERE ticker = $1", [ticker]);
  const [report] = await safe<Report>(
    `SELECT period, to_char(reported_on, 'YYYY-MM-DD') AS reported_on, url, market, data, ai
     FROM earnings_reports WHERE ticker = $1 ORDER BY reported_on DESC, created_at DESC LIMIT 1`, [ticker],
  );
  const flows = market === "KR" ? (await safe<{ day: string; close: string; foreign_net: string; institution_net: string; individual_net: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, close, foreign_net, institution_net, individual_net FROM investor_flows WHERE ticker = $1 ORDER BY day", [ticker],
  )).map<FlowRow>((f) => ({ day: f.day, close: Number(f.close), foreign: Number(f.foreign_net), institution: Number(f.institution_net), individual: Number(f.individual_net) })) : [];
  const filings = market === "KR" ? await safe<{ kind: string; day: string }>(
    "SELECT kind, to_char(day, 'YYYY-MM-DD') AS day FROM stock_disclosures WHERE ticker = $1 AND day >= CURRENT_DATE - 31", [ticker],
  ) : [];
  const newsDays = (await safe<{ day: string }>(
    "SELECT to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day FROM stock_news WHERE ticker = $1 AND published_at > now() - interval '8 days'", [ticker],
  )).map((n) => n.day);
  const events = await safe<{ day: string; kind: string; title: string; ticker: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, title, ticker FROM calendar_events
     WHERE day BETWEEN CURRENT_DATE AND CURRENT_DATE + 14 AND (ticker = $1 OR (ticker = '' AND kind = 'policy')) ORDER BY day`, [ticker],
  );
  return {
    market, today, price: priceRow?.cur == null ? null : Number(priceRow.cur), candles, statements,
    shares: shareRow ? Number(shareRow.shares) : null, report: report ?? null, flows, filings, newsDays, events,
  };
}
