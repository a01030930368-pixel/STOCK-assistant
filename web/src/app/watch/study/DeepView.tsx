// 기업 공부 › 깊이 보기 탭(D): 앱이 재무제표·주가로 계산하는 숫자 분석
import type { BriefInput } from "@/lib/brief";
import {
  DISCOUNT, dupont, dupontSentence, growthLatest, impliedGrowth, impliedSentence, pastGrowth, perHistory, quarters, safety, ttm, type QRow,
} from "@/lib/deep";
import { money, quarterLabel } from "@/lib/statements";
import DeepNote from "./DeepNote";

const pct = (v: number | null, d = 1) => (v === null ? "-" : `${v.toFixed(d)}%`);
const times = (v: number | null) => (v === null ? "-" : `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}배`);

export default function DeepView({ ticker, input, note }: { ticker: string; input: BriefInput; note: string }) {
  const rows = input.statements, market: "KR" | "US" = input.market === "US" ? "US" : "KR";
  const qs = quarters(rows);
  const cap = input.price && input.shares ? input.price * input.shares : null;
  const s = safety(rows, cap);
  const d = dupont(rows);
  const per = perHistory(input.candles, rows, input.shares, input.price);
  const ni = ttm(rows, "net_income");
  const g = impliedGrowth(cap, ni, DISCOUNT[market]);
  const past = pastGrowth(rows, "net_income") ?? pastGrowth(rows, "revenue");
  const yoy = growthLatest(rows);
  const m = (v: number | null) => money(v, market);

  if (!qs.length) {
    return <div className="panel"><b>아직 재무제표가 없어요</b><p className="muted">앱이 재무제표를 모으면(보통 하루 안) 여기에 실적 흐름과 분석이 보여요.</p></div>;
  }
  return (
    <div className="deep-grid">
      <section className="panel deep-card deep-wide">
        <h3>{qs.length}분기 실적 흐름<span className="deep-auto">앱이 채움</span></h3>
        <div className="deep-legend muted"><span><i className="sw gold-bg" />매출</span><span><i className="sw line" />영업이익률</span>
          {yoy !== null && <span className="deep-right">최근 분기 매출 1년 전보다 <b className={yoy >= 0 ? "up" : "down"}>{yoy >= 0 ? "+" : ""}{yoy.toFixed(0)}%</b></span>}</div>
        <QuarterChart rows={qs} market={market} />
        <p className="muted deep-small">{trendSentence(qs)}</p>
      </section>

      <section className="panel deep-card">
        <h3>ROE는 어디서 나오나 (듀퐁)<span className="deep-auto">앱이 채움</span></h3>
        {d.at(-1)?.roe != null ? (
          <>
            <p className="deep-big">ROE <b className="gold">{pct(d.at(-1)!.roe)}</b> = 순이익률 {pct(d.at(-1)!.margin)} × 자산 회전 {d.at(-1)!.turnover?.toFixed(2) ?? "-"} × 레버리지 {times(d.at(-1)!.leverage)}</p>
            <table className="deep-table">
              <thead><tr><th /><th>ROE</th><th>순이익률</th><th>자산 회전</th><th>레버리지</th></tr></thead>
              <tbody>{d.map((x) => <tr key={x.label}><td>{x.label}</td><td>{pct(x.roe)}</td><td>{pct(x.margin)}</td><td>{x.turnover?.toFixed(2) ?? "-"}</td><td>{times(x.leverage)}</td></tr>)}</tbody>
            </table>
            <p className="muted deep-small">{dupontSentence(d)}</p>
          </>
        ) : <p className="muted">순이익·자산·자본 숫자가 모자라 계산하지 못했어요.</p>}
      </section>

      <section className="panel deep-card">
        <h3>버틸 힘 (재무 안전)<span className="deep-auto">앱이 채움</span></h3>
        <div className="deep-kpis">
          <div><span>부채비율</span><b>{pct(s.debt, 0)}</b><em>{s.debtBefore !== null ? `1년 전 ${pct(s.debtBefore, 0)}` : ""}</em></div>
          <div><span>현금 비중(자산 중)</span><b>{pct(s.cashShare, 0)}</b><em /></div>
          <div><span>자본 1년 증가</span><b>{s.equityGrowth === null ? "-" : `${s.equityGrowth >= 0 ? "+" : ""}${s.equityGrowth.toFixed(0)}%`}</b><em /></div>
          <div><span>이익의 질</span><b>{times(s.cashQuality)}</b><em>영업현금 ÷ 순이익</em></div>
        </div>
        <p className="muted deep-small">{safetySentence(s)}</p>
      </section>

      <section className="panel deep-card">
        <h3>돈이 실제로 남나 (잉여현금)<span className="deep-auto">앱이 채움</span></h3>
        {qs.some((q) => q.fcf !== null) ? (
          <>
            <FcfChart rows={qs} />
            <p className="deep-mid">최근 4분기 FCF <b>{m(s.fcfTtm)}</b>{s.fcfYield !== null && <> · 시가총액 대비 <b>{pct(s.fcfYield)}</b></>}</p>
            <p className="muted deep-small">FCF = 영업으로 번 현금 − 설비투자{s.capexShare !== null && ` · 설비투자는 매출의 ${pct(s.capexShare, 0)}`}</p>
          </>
        ) : <p className="muted">현금흐름표 숫자가 아직 없어요.</p>}
      </section>

      <section className="panel deep-card">
        <h3>비싼가 싼가 (PER 흐름)<span className="deep-auto">앱이 채움</span></h3>
        {per ? (
          <>
            <PerChart band={per} />
            <p className="deep-mid">지금 PER <b>{times(per.current)}</b>{per.position !== null && <> · 그동안 낮은 순으로 <b>{per.position}%</b> 자리</>}</p>
            <p className="muted deep-small">점선: 평균 {times(per.avg)} · <span className="down">낮을 때 {times(per.low)}</span> · <span className="up">높을 때 {times(per.high)}</span>. 사이클 업종은 이익이 꼭대기일 때 PER이 낮게 보여요.</p>
          </>
        ) : <p className="muted">주가 기록이나 주식 수가 모자라 PER 흐름을 그리지 못했어요.</p>}
      </section>

      <section className="panel deep-card">
        <h3>지금 주가가 가정하는 것 (역산)<span className="deep-auto">앱이 채움</span></h3>
        {g !== null ? (
          <>
            <p className="deep-big">{g >= 0
              ? <>앞으로 10년 순이익이 <b className="gold">연 {g.toFixed(1)}%</b> 늘면 지금 주가가 맞아요.</>
              : <>앞으로 10년 순이익이 <b className="gold">연 {Math.abs(g).toFixed(1)}%</b>씩 줄어도 지금 주가가 맞아요.</>}</p>
            <GrowthBar implied={g} past={past?.pct ?? null} />
          </>
        ) : null}
        <p className="muted deep-small">{impliedSentence(g, past)} (요구 수익률 연 {DISCOUNT[market] * 100}%, 10년 뒤엔 연 2.5% 성장으로 계산)</p>
        <DeepNote ticker={ticker} initial={note} />
      </section>
      <p className="muted deep-small deep-wide">숫자는 {market === "KR" ? "DART" : "SEC"} 분기 재무제표와 주가로 앱이 계산해요. 분기 숫자는 분기가 끝나고 보고서가 나온 뒤에 들어와요.</p>
    </div>
  );
}

function trendSentence(qs: QRow[]): string {
  const rev = qs.map((q) => q.revenue).filter((v): v is number => v !== null);
  const opm = qs.map((q) => q.opm).filter((v): v is number => v !== null);
  const parts: string[] = [];
  let streak = 0;
  for (let i = rev.length - 1; i > 0 && rev[i] > rev[i - 1]; i--) streak++;
  if (streak >= 2) parts.push(`매출이 ${streak}분기 연속 늘었어요`);
  const losses = qs.filter((q) => q.op !== null && q.op < 0).length;
  if (opm.length) parts.push(`영업이익률은 ${Math.min(...opm).toFixed(0)}~${Math.max(...opm).toFixed(0)}% 사이`);
  parts.push(losses ? `영업적자 분기가 ${losses}번 있었어요` : "영업적자 분기는 없었어요");
  return parts.join(" · ") + ".";
}

function safetySentence(s: ReturnType<typeof safety>): string {
  if (s.debt === null) return "";
  const a = s.debt < 100 ? "부채가 자본보다 적어요." : s.debt < 200 ? "부채가 자본의 1~2배예요. 업종 평균과 비교해 보세요." : "부채가 자본의 2배를 넘어요. 금리가 오르면 부담이 커져요.";
  const b = s.cashQuality === null ? "" : s.cashQuality >= 1 ? " 이익만큼 현금도 들어와요." : " 이익보다 들어온 현금이 적어요. 외상(매출채권)·재고가 늘었는지 보세요.";
  return a + b;
}

// ---------------------------------------------------------------- 차트(SVG)

function QuarterChart({ rows, market }: { rows: QRow[]; market: "KR" | "US" }) {
  const W = 1100, H = 200, pad = 18, n = rows.length, bw = (W - 8) / n;
  const rev = rows.map((r) => r.revenue ?? 0), hi = Math.max(...rev, 1), lo = Math.min(0, ...rev);
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - pad * 2);
  const opm = rows.map((r) => r.opm);
  const om = opm.filter((v): v is number => v !== null), olo = Math.min(...om, 0), ohi = Math.max(...om, 1);
  const oy = (v: number) => pad + ((ohi - v) / (ohi - olo || 1)) * (H - pad * 2.6);
  const line = opm.map((v, i) => (v === null ? null : `${(4 + i * bw + bw / 2).toFixed(1)},${oy(v).toFixed(1)}`)).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="deep-svg" role="img" aria-label="분기 매출과 영업이익률">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="deep-axis" />
      {rows.map((r, i) => {
        const v = r.revenue ?? 0, x = 4 + i * bw + bw * 0.18;
        return (
          <g key={r.period}>
            <rect x={x} y={Math.min(y(v), y(0))} width={bw * 0.64} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={3} className={v >= 0 ? "deep-bar" : "deep-bar neg"}>
              <title>{`${quarterLabel(r.period)} 매출 ${money(r.revenue, market)} · 영업이익 ${money(r.op, market)} · 영업이익률 ${r.opm === null ? "-" : r.opm.toFixed(1) + "%"}`}</title>
            </rect>
            {(i % 4 === 0 || i === n - 1) && <text x={x + bw * 0.32} y={H - 2} className="deep-lab" textAnchor="middle">{quarterLabel(r.period)}</text>}
          </g>
        );
      })}
      {line && <polyline points={line} className="deep-line" />}
    </svg>
  );
}

function FcfChart({ rows }: { rows: QRow[] }) {
  const W = 360, H = 110, pad = 12, n = rows.length, bw = (W - 8) / n;
  const v = rows.map((r) => r.fcf ?? 0), hi = Math.max(...v, 0), lo = Math.min(...v, 0), span = hi - lo || 1;
  const y = (x: number) => pad + ((hi - x) / span) * (H - pad * 2 - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="deep-svg" role="img" aria-label="분기 잉여현금흐름">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="deep-axis" />
      {rows.map((r, i) => {
        const val = r.fcf ?? 0, x = 4 + i * bw + bw * 0.2;
        return (
          <g key={r.period}>
            <rect x={x} y={Math.min(y(val), y(0))} width={bw * 0.6} height={Math.max(1, Math.abs(y(val) - y(0)))} rx={2} className={val >= 0 ? "deep-bar" : "deep-bar neg"}><title>{quarterLabel(r.period)}</title></rect>
            {(i % 4 === 0 || i === n - 1) && <text x={x + bw * 0.3} y={H - 1} className="deep-lab" textAnchor="middle">{quarterLabel(r.period)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function PerChart({ band }: { band: NonNullable<ReturnType<typeof perHistory>> }) {
  const W = 360, H = 120, pad = 10;
  const vals = band.points.map((p) => p.per), lo = Math.min(...vals, band.low) * 0.95, hi = Math.max(...vals, band.high) * 1.05;
  const x = (i: number) => (i * W) / (vals.length - 1), y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - pad * 2);
  const ref = [["평균", band.avg, "deep-ref"], ["낮을 때", band.low, "deep-ref low"], ["높을 때", band.high, "deep-ref high"]] as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="deep-svg" role="img" aria-label="PER 흐름">
      {ref.map(([lab, v, cls]) => <line key={lab} x1={0} x2={W} y1={y(v)} y2={y(v)} className={cls}><title>{`${lab} ${v.toFixed(1)}배`}</title></line>)}
      <polyline points={vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} className="deep-line gold-line" />
      <text x={0} y={H - 1} className="deep-lab">{band.points[0].day.slice(0, 7).replace("-", ".")}</text>
    </svg>
  );
}

function GrowthBar({ implied, past }: { implied: number; past: number | null }) {
  const top = Math.max(20, implied, past ?? 0) * 1.15, bottom = Math.min(0, implied, past ?? 0);
  const pos = (v: number) => `${((v - bottom) / (top - bottom)) * 100}%`;
  // 글자는 막대 끝에서 잘리지 않게 안쪽으로 붙여요
  const lab = (v: number) => `${Math.max(12, Math.min(88, ((v - bottom) / (top - bottom)) * 100))}%`;
  return (
    <div className="deep-gbar">
      <div className="deep-gtrack" />
      <b style={{ left: pos(implied) }} />
      <span className="deep-gnow" style={{ left: lab(implied) }}>지금 가정 {implied.toFixed(1)}%</span>
      {past !== null && <><i style={{ left: pos(past) }} /><span className="deep-gpast" style={{ left: lab(past) }}>지난 실제 {past.toFixed(1)}%</span></>}
    </div>
  );
}
