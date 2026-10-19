import { rateGap } from "@/lib/macro";

export type Snapshot = {
  id: number; snapshot_day: string; kr_base_rate: string | null; us_base_rate: string | null; usdkrw: string | null;
  gdp_outlook: string | null; inflation: string | null; us_inflation: string | null; key_variables: string | null;
  implications: string | null;
};

// 매크로 메모 한 건을 보여 줍니다. 매크로 페이지와 매매일지에서 같이 씁니다.
export const SNAPSHOT_COLUMNS = "*, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_day";

const pct = (v: string | null) => (v === null ? "-" : `${Number(v)}%`);

export default function MacroCard({ s, title }: { s: Snapshot; title?: string }) {
  const gap = rateGap(s.kr_base_rate, s.us_base_rate);
  return (
    <div className="card">
      <strong>{title ?? s.snapshot_day}</strong>
      <div className="muted">
        기준금리 한국 {pct(s.kr_base_rate)} · 미국 {pct(s.us_base_rate)} · 금리차 {gap === null ? "-" : `${gap}%p`} ·
        원/달러 {s.usdkrw === null ? "-" : Number(s.usdkrw).toLocaleString("ko-KR")} · 물가 한국 {pct(s.inflation)} · 미국 {pct(s.us_inflation)}
      </div>
      {s.gdp_outlook && <div>GDP 성장률 전망: {s.gdp_outlook}</div>}
      {s.key_variables && <div>주요 변수: {s.key_variables}</div>}
      {s.implications && <div>시사점: {s.implications}</div>}
    </div>
  );
}
