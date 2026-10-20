import { today } from "@/lib/format";
import { formNumber } from "@/lib/fills";
import { loadFills } from "@/lib/fillsData";
import Principles from "../Principles";
import BuyForm, { type Known } from "./BuyForm";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BuyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [fill] = params.fill ? (await loadFills(params.fill)).filter((f) => f.side === "buy") : [];
  // 티커를 치면 이름·시장을 채울 종목: 보유·체결·관심·검색기
  const known = await query<Known>(
    `SELECT DISTINCT ON (ticker) ticker, name, market FROM (
       SELECT ticker, name, market, 1 AS rank FROM holdings
       UNION ALL SELECT ticker, name, market, 2 FROM watchlist
       UNION ALL SELECT ticker, name, market, 3 FROM trade_fills WHERE name <> ''
       UNION ALL SELECT ticker, name, 'KR', 4 FROM screener_stocks
     ) s ORDER BY ticker, rank LIMIT 3000`,
  ).catch(() => [] as Known[]);
  return (
    <>
      <h1>매수 기록</h1>
      {fill && (
        <div className="callout fill-note">키움 체결에서 종목·날짜·수량·가격을 채웠어요. 체크리스트만 적으면 돼요.</div>
      )}
      <Principles />
      <BuyForm
        ticker={fill?.ticker ?? params.ticker ?? ""}
        name={fill?.name ?? params.name ?? ""}
        market={fill?.market ?? params.market ?? "KR"}
        today={fill?.day ?? today()}
        quantity={fill ? formNumber(fill.quantity, "US") : ""}
        price={fill ? formNumber(fill.price, fill.market) : ""}
        fillKey={fill?.key ?? ""}
        known={known}
      />
    </>
  );
}
