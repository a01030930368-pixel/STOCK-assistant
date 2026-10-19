import Link from "next/link";
import { query } from "@/lib/db";
import { fixedPct } from "@/lib/format";
import { rateGap } from "@/lib/macro";

type Indicator = { code: string; value: string };

// 모든 화면 맨 위에 늘 보이는 지표 띠. 워커가 처음 돌기 전에는 테이블이 없을 수 있습니다.
export default async function MacroStrip() {
  const rows = await query<Indicator>("SELECT code, value FROM macro_indicators").catch(() => []);
  const [sync] = await query<{ synced_at: Date }>(
    "SELECT max(synced_at) AS synced_at FROM (SELECT synced_at FROM account_summary UNION ALL SELECT synced_at FROM us_account_summary) s",
  ).catch(() => []);
  const v = Object.fromEntries(rows.map((r) => [r.code, r.value]));
  const gap = rateGap(v.kr_base_rate ?? null, v.us_base_rate ?? null);
  const items: [string, string][] = [
    ["한국 기준금리", fixedPct(v.kr_base_rate)],
    ["미국 기준금리", fixedPct(v.us_base_rate)],
    ["금리차", gap === null ? "-" : `${gap > 0 ? "+" : ""}${gap.toFixed(2)}%p`],
    ["원/달러", v.usdkrw ? Number(v.usdkrw).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"],
    ["한국 물가", fixedPct(v.kr_cpi_yoy)],
    ["미국 물가", fixedPct(v.us_cpi_yoy)],
  ];
  const time = sync?.synced_at
    ? new Date(sync.synced_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  return (
    <div className="macro-strip">
      <Link href="/macro" className="macro-strip-inner" style={{ textDecoration: "none" }}>
        {items.map(([k, value]) => (
          <span key={k}><span className="k">{k}</span><span className="v">{value}</span></span>
        ))}
        {time && <span className="synced"><span className="dot">●</span>{time} 동기화</span>}
      </Link>
    </div>
  );
}
