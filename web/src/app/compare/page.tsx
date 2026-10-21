import { query } from "@/lib/db";
import { daysBefore, dividendYield, growthOf, multiple, parseTickers, PERIODS, type Close, type Metrics, type PeriodKey } from "@/lib/compare";
import { perShare } from "@/lib/bands";
import { operatingMargin, debtRatio, type FinancialRow } from "@/lib/research";
import type { StatementRow } from "@/lib/statements";
import { marketOf } from "@/lib/journal";
import { today } from "@/lib/format";
import CompareView, { type Stock } from "./CompareView";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);

// 이름을 아는 종목: 보유·ISA·관심·매매한 종목·검색기 목록
async function known(): Promise<{ ticker: string; name: string; market: "KR" | "US" }[]> {
  return safe(
    `SELECT DISTINCT ON (ticker) ticker, name, market FROM (
       SELECT ticker, name, market, 1 AS r FROM holdings
       UNION ALL SELECT ticker, name, 'KR', 2 FROM isa_holdings
       UNION ALL SELECT ticker, name, market, 3 FROM watchlist
       UNION ALL SELECT ticker, NULLIF(name, ''), market, 4 FROM trade_fills
       UNION ALL SELECT ticker, name, market, 5 FROM screener_stocks) s
     WHERE name IS NOT NULL ORDER BY ticker, r`,
  );
}

async function load(ticker: string, market: "KR" | "US", name: string, day: string): Promise<Stock> {
  const bars = await safe<{ day: string; close: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, close FROM price_history WHERE ticker = $1 AND day >= $2 ORDER BY day", [ticker, daysBefore(day, 400)],
  );
  const closes: Close[] = bars.map((b) => ({ day: b.day, close: Number(b.close) }));
  const [cur] = await safe<{ price: string | null }>(
    `SELECT COALESCE((SELECT cur_price FROM holdings WHERE ticker = $1 LIMIT 1), (SELECT price FROM watch_quotes WHERE ticker = $1)) AS price`, [ticker],
  );
  const price = cur?.price ? Number(cur.price) : closes.at(-1)?.close ?? null;
  const statements = (await safe<{ kind: "Y" | "Q" | "C"; period: string; item: string; value: string }>(
    "SELECT kind, period, item, value FROM stock_statements WHERE ticker = $1", [ticker],
  )).map((r): StatementRow => ({ ...r, value: Number(r.value) }));
  const [share] = await safe<{ shares: string }>("SELECT shares FROM stock_shares WHERE ticker = $1", [ticker]);
  const shares = share ? Number(share.shares) : null;
  const fin = await safe<FinancialRow>("SELECT * FROM stock_financials WHERE ticker = $1 ORDER BY period DESC LIMIT 3", [ticker]);
  const divs = await safe<{ day: string; amount: string }>(
    "SELECT to_char(ex_date, 'YYYY-MM-DD') AS day, amount FROM stock_dividends WHERE ticker = $1", [ticker],
  );
  const flows = market === "KR" ? await safe<{ foreign_net: string }>(
    "SELECT foreign_net FROM investor_flows WHERE ticker = $1 ORDER BY day DESC LIMIT 20", [ticker],
  ) : [];
  const metrics: Omit<Metrics, "ret"> = {
    per: shares ? multiple(perShare(statements, shares, "per"), price, day) : null,
    pbr: shares ? multiple(perShare(statements, shares, "pbr"), price, day) : null,
    dividend: dividendYield(divs.map((d) => ({ day: d.day, amount: Number(d.amount) })), price, day),
    growth: growthOf(fin.map((f) => ({ period: f.period, revenue: f.revenue === null ? null : Number(f.revenue) }))),
    margin: fin[0] ? operatingMargin(fin[0]) : null,
    debt: fin[0] ? debtRatio(fin[0]) : null,
    foreign20: flows.length ? flows.reduce((s, f) => s + Number(f.foreign_net), 0) : null,
  };
  return { ticker, name, market, closes, price, metrics, hasFinancials: fin.length > 0 || statements.length > 0 };
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ t?: string; p?: string }> }) {
  const params = await searchParams;
  const tickers = parseTickers(params.t);
  const period = (PERIODS.find((p) => p.key === params.p)?.key ?? "6M") as PeriodKey;
  const names = await known();
  const byTicker = new Map(names.map((n) => [n.ticker, n]));
  const day = today();
  const stocks = await Promise.all(tickers.map((t) => {
    const k = byTicker.get(t);
    return load(t, k?.market ?? marketOf(t, "KR"), k?.name ?? t, day);
  }));
  const [status] = await safe<{ value: { at: string; ok: boolean; error?: string } | null }>("SELECT value FROM app_settings WHERE key = 'history_status'");
  const [pending] = await safe<{ value: { tickers?: [string, string][] } | null }>("SELECT value FROM app_settings WHERE key = 'history_request'");
  return (
    <CompareView stocks={stocks} period={period} today={day} options={names}
      pending={(pending?.value?.tickers ?? []).map(([t]) => t)} error={status?.value && !status.value.ok ? status.value.error ?? null : null} />
  );
}
