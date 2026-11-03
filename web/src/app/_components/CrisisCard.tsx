import Link from "next/link";
import { manwon, pct, SCENARIOS, shock, WINDOWS, type CrisisCash, type CrisisHolding } from "@/lib/crisis";

// 포트폴리오 홈의 위기 리허설 카드: "코스피가 −20% 빠지면 내 계좌는 약 −N만 원"
export default function CrisisCard({ holdings, cash, rate }: { holdings: CrisisHolding[]; cash: CrisisCash; rate: number }) {
  if (holdings.length === 0) return null;
  const s = SCENARIOS[0];
  const r = shock(holdings, cash, rate, s);
  return (
    <div className="panel crisis-card">
      <div className="panel-title">🧯 위기 리허설 <Link href="/crisis" className="muted">자세히 ›</Link></div>
      <div>코스피가 <b>−20%</b> 빠지면 내 계좌는</div>
      <div className={`crisis-big ${r.change < 0 ? "down" : r.change > 0 ? "up" : ""}`}>약 {manwon(r.change)} <small>({pct(r.pct)})</small></div>
      <div className="crisis-chips">
        {[...SCENARIOS, WINDOWS[0]].map((x) => (
          <Link key={x.id} href={`/crisis?s=${x.id}`} className={`chip-btn${x.id === s.id ? " on" : ""}`}>{x.label}</Link>
        ))}
      </div>
      <div className="muted crisis-foot">손절가에 닿는 종목 {r.hits.length}개 · 현금 {r.cashBefore.toFixed(1)}%</div>
    </div>
  );
}
