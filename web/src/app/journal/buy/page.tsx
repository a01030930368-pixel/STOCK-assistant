import { today } from "@/lib/format";
import Principles from "../Principles";
import BuyForm from "./BuyForm";

export const dynamic = "force-dynamic";

export default async function BuyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return (
    <>
      <h1>매수 기록</h1>
      <Principles />
      <BuyForm ticker={params.ticker ?? ""} name={params.name ?? ""} market={params.market ?? "KR"} today={today()} />
    </>
  );
}
