import { query } from "@/lib/db";
import { today } from "@/lib/format";
import { mine, returns, type Close, type HoldingIn, type SectorRow } from "@/lib/sectors";
import MacroTabs from "../MacroTabs";
import SectorView, { type MarketData } from "./SectorView";

export const dynamic = "force-dynamic";

type IndexRow = { market: "KR" | "US"; code: string; name: string; price: string; change_pct: string; weight: string | null; leaders: { name: string; pct: number }[]; updated_at: Date };
type DailyRow = { market: string; code: string; day: string; close: string };
type Holding = { market: "KR" | "US"; name: string; sector: string | null; amount: string; pnl_pct: string };
type Status = Record<string, { at: string; ok: boolean; error?: string }>;

// 워커가 처음 돌기 전의 예전 DB에는 테이블이 없을 수 있어요.
const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);

export default async function SectorsPage() {
  const day = today();
  const [index, daily, holdings, status] = await Promise.all([
    safe<IndexRow>("SELECT market, code, name, price, change_pct, weight, leaders, updated_at FROM sector_index"),
    safe<DailyRow>("SELECT market, code, day::text AS day, close FROM sector_daily WHERE day >= current_date - 420 ORDER BY day"),
    safe<Holding>(
      `SELECT CASE WHEN h.market = 'ISA' THEN 'KR' ELSE h.market END AS market, h.name, COALESCE(s.custom, NULLIF(s.sector, '')) AS sector, h.eval_amount AS amount, h.pnl_pct
         FROM (SELECT ticker, name, market, eval_amount, pnl_pct FROM holdings WHERE quantity > 0
               UNION ALL SELECT ticker, name, 'ISA', eval_amount, pnl_pct FROM isa_holdings WHERE quantity > 0) h
         LEFT JOIN stock_sectors s ON s.ticker = h.ticker`,
    ),
    safe<{ value: Status }>("SELECT value FROM app_settings WHERE key = 'sectors_status'").then((r) => r[0]?.value ?? {}),
  ]);

  const closes = new Map<string, Close[]>();
  for (const d of daily) {
    const key = `${d.market}:${d.code}`;
    if (!closes.has(key)) closes.set(key, []);
    closes.get(key)!.push({ day: d.day, close: Number(d.close) });
  }

  const build = (market: "KR" | "US"): MarketData => {
    const list = index.filter((r) => r.market === market);
    const held: HoldingIn[] = holdings.filter((h) => h.market === market).map((h) => ({ name: h.name, sector: h.sector, amount: Number(h.amount), pnlPct: Number(h.pnl_pct) }));
    const mines = mine(market, list, held);
    const rows: SectorRow[] = list.map((r) => ({
      code: r.code, name: r.name, weight: r.weight === null ? null : Number(r.weight), leaders: r.leaders ?? [],
      ret: returns(Number(r.price), Number(r.change_pct), closes.get(`${market}:${r.code}`) ?? [], day),
      mine: mines.get(r.code) ?? null,
    }));
    const updated = list.reduce<Date | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null);
    // 마지막 시도가 실패했고 그 뒤로 새 값이 없을 때만 알려요. 긴 오류는 첫 부분만 보여요.
    const st = status[market];
    const failed = st && !st.ok && (!updated || new Date(st.at) > updated);
    const error = failed ? (st.error ?? "알 수 없는 오류").split("; ")[0].slice(0, 120) : null;
    return { rows, updated: updated ? updated.toISOString() : null, error, held: held.length };
  };

  return (
    <>
      <div className="board-head">
        <h1>매크로 환경</h1>
        <MacroTabs on="sectors" />
      </div>
      <SectorView kr={build("KR")} us={build("US")} />
    </>
  );
}
