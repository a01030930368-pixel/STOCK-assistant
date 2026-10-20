import { today } from "@/lib/format";
import { formNumber } from "@/lib/fills";
import { loadFills } from "@/lib/fillsData";
import Principles from "../Principles";
import BuyForm from "./BuyForm";

export const dynamic = "force-dynamic";

export default async function BuyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [fill] = params.fill ? (await loadFills(params.fill)).filter((f) => f.side === "buy") : [];
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
      />
    </>
  );
}
