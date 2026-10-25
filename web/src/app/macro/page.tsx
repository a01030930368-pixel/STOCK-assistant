import { query } from "@/lib/db";
import { asOf, fixedPct, today } from "@/lib/format";
import { rateGap } from "@/lib/macro";
import MacroCard, { SNAPSHOT_COLUMNS, type Snapshot } from "./MacroCard";
import MacroForm from "./MacroForm";
import MacroTabs from "./MacroTabs";
import MarketBoard from "./MarketBoard";
import type { Point } from "@/lib/markets";

export const dynamic = "force-dynamic";

type Indicator = { code: string; value: string; as_of: string };

const LABELS: Record<string, string> = {
  kr_base_rate: "한국 기준금리", us_base_rate: "미국 기준금리(상단)", usdkrw: "원/달러 환율",
  kr_cpi_yoy: "한국 물가 상승률", us_cpi_yoy: "미국 물가 상승률",
};

const trim = (v: string | undefined) => (v === undefined ? "" : String(Number(v)));

export default async function MacroPage() {
  // 워커가 처음 돌기 전의 예전 DB에는 지표 테이블이 없을 수 있습니다.
  const indicators = await query<Indicator>("SELECT code, value, as_of FROM macro_indicators").catch(() => []);
  const latest = Object.fromEntries(indicators.map((i) => [i.code, i]));
  const date = today();
  const [todays] = await query<Snapshot>(`SELECT ${SNAPSHOT_COLUMNS} FROM macro_snapshots WHERE snapshot_date = $1`, [date]);
  const history = await query<Snapshot>(`SELECT ${SNAPSHOT_COLUMNS} FROM macro_snapshots ORDER BY snapshot_date DESC LIMIT 30`);

  // 오늘 메모가 있으면 그 내용을, 없으면 최신 지표를 기본값으로 채웁니다.
  const defaults: Record<string, string> = todays
    ? {
        snapshotDate: date, krBaseRate: todays.kr_base_rate ?? "", usBaseRate: todays.us_base_rate ?? "",
        usdkrw: todays.usdkrw ?? "", inflation: todays.inflation ?? "", usInflation: todays.us_inflation ?? "",
        gdpOutlook: todays.gdp_outlook ?? "", keyVariables: todays.key_variables ?? "", implications: todays.implications ?? "",
      }
    : {
        snapshotDate: date, krBaseRate: trim(latest.kr_base_rate?.value), usBaseRate: trim(latest.us_base_rate?.value),
        usdkrw: trim(latest.usdkrw?.value), inflation: trim(latest.kr_cpi_yoy?.value), usInflation: trim(latest.us_cpi_yoy?.value),
      };
  // 국내·해외 지수(워커가 market 'MK'로 넣어요). 1년 차트와 하루 등락을 그릴 만큼만 읽어요.
  const daily = await query<{ code: string; day: string; close: string }>(
    "SELECT code, day::text AS day, close FROM sector_daily WHERE market = 'MK' AND day >= current_date - 400 ORDER BY day",
  ).catch(() => []);
  const series: Record<string, Point[]> = {};
  for (const d of daily) (series[d.code] ??= []).push({ day: d.day, close: Number(d.close) });
  const [markets] = await query<{ value: { at: string; errors?: Record<string, string> } }>("SELECT value FROM app_settings WHERE key = 'markets_status'").catch(() => []);
  const gap = rateGap(latest.kr_base_rate?.value ?? null, latest.us_base_rate?.value ?? null);

  return (
    <>
      <div className="board-head">
        <h1>매크로 환경</h1>
        <MacroTabs on="indicators" />
      </div>
      <MarketBoard series={series} status={markets?.value ?? null} />
      <h2>최신 지표</h2>
      {indicators.length === 0 ? (
        <p className="card muted">자동으로 가져온 지표가 아직 없습니다. .env에 ECOS_API_KEY와 FRED_API_KEY를 넣으면 워커가 6시간마다 가져옵니다. 키가 없어도 아래에 직접 적을 수 있습니다.</p>
      ) : (
        <div className="card">
          <div className="row tight">
            {Object.entries(LABELS).map(([code, label]) => (
              <div key={code}>
                <div className="muted">{label}</div>
                <strong className="num">{!latest[code] ? "-" : code === "usdkrw" ? `${Number(latest[code].value).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원` : fixedPct(latest[code].value)}</strong>
                {latest[code] && <div className="muted">{asOf(latest[code].as_of)} 기준</div>}
              </div>
            ))}
            <div><div className="muted">한미 금리차</div><strong className="num">{gap === null ? "-" : `${gap.toFixed(2)}%p`}</strong></div>
          </div>
        </div>
      )}

      <h2>{todays ? "오늘 메모 고치기" : "오늘 메모 쓰기"}</h2>
      <p className="muted">매매일지에 매수·매도를 기록하면, 그날(또는 그 전 가장 최근) 메모가 자동으로 함께 저장됩니다.</p>
      <MacroForm defaults={defaults} />

      <h2>지난 메모</h2>
      {history.length === 0 && <p className="muted">없습니다.</p>}
      {history.map((s) => <MacroCard key={s.id} s={s} />)}
    </>
  );
}
