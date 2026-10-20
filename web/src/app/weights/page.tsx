import { usdKrw } from "@/lib/fx";
import Link from "next/link";
import { saveLimits, saveSector } from "@/app/actions";
import { query } from "@/lib/db";
import { breaches, CASH, weights, type HoldingIn, type Limits, type Part } from "@/lib/weights";

export const dynamic = "force-dynamic";

type Row = { ticker: string; name: string; market: "KR" | "US" | "ISA"; eval_amount: string; pnl_pct: string; auto: string | null; custom: string | null };

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);
const DEFAULT_LIMITS: Limits = { sectorMax: 40, stockMax: 20, cashMin: 10 };
// 다크 배경에서 색약 검사를 통과한 4색 + 나머지·현금은 회색 두 단계. 빨강·파랑은 오름·내림 전용이라 쓰지 않습니다.
const COLORS = ["#c98500", "#199e70", "#9085e9", "#d55181"];
const REST = "#6b675f", CASH_COLOR = "#3d3a35";
const krw = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}억원` : `${Math.round(v / 1e4).toLocaleString("ko-KR")}만원`);

// 4개 넘으면 나머지는 "그 밖"으로 묶습니다. 현금은 늘 맨 끝 회색.
function slices(parts: Part[], restLabel = "그 밖"): (Part & { color: string })[] {
  const cash = parts.filter((p) => p.key === CASH);
  const rest = parts.filter((p) => p.key !== CASH);
  const top = rest.slice(0, COLORS.length).map((p, i) => ({ ...p, color: COLORS[i] }));
  const others = rest.slice(COLORS.length);
  if (others.length) {
    const amount = others.reduce((s, p) => s + p.amount, 0);
    top.push({ key: "rest", label: `${restLabel} ${others.length}개`, amount, pct: Math.round(others.reduce((s, p) => s + p.pct, 0) * 10) / 10, color: REST });
  }
  return [...top, ...cash.map((p) => ({ ...p, color: CASH_COLOR }))];
}

function Donut({ title, parts, center }: { title: string; parts: (Part & { color: string })[]; center: string }) {
  const R = 70, SW = 22, C = R + SW / 2, total = parts.reduce((s, p) => s + p.amount, 0);
  const gap = parts.length > 1 ? 0.03 : 0;
  let a = -Math.PI / 2;
  return (
    <div className="panel donut-card">
      <div className="panel-title">{title}</div>
      <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="donut" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${p.pct}%`).join(", ")}`}>
        {total > 0 && parts.map((p) => {
          const span = (p.amount / total) * Math.PI * 2;
          if (span >= Math.PI * 2 - 0.001) return <circle key={p.key} cx={C} cy={C} r={R} fill="none" stroke={p.color} strokeWidth={SW}><title>{`${p.label} ${p.pct}%`}</title></circle>;
          const b = a + span - gap;
          const d = `M${C + R * Math.cos(a)} ${C + R * Math.sin(a)} A${R} ${R} 0 ${b - a > Math.PI ? 1 : 0} 1 ${C + R * Math.cos(b)} ${C + R * Math.sin(b)}`;
          a += span;
          return <path key={p.key} d={d} fill="none" stroke={p.color} strokeWidth={SW}><title>{`${p.label} ${p.pct}% · ${krw(p.amount)}`}</title></path>;
        })}
        <text x={C} y={C + 6} textAnchor="middle" className="donut-center">{center}</text>
      </svg>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}><i style={{ background: p.color }} /> <span>{p.label}</span> <b className="num">{p.pct}%</b></li>
        ))}
      </ul>
    </div>
  );
}

export default async function WeightsPage() {
  // ISA 계좌 종목도 함께 넣습니다(같은 종목이 일반 계좌에도 있으면 따로 한 조각씩).
  const rows = await safe<Row>(
    `SELECT h.ticker, h.name, h.market, h.eval_amount, h.pnl_pct, s.sector AS auto, s.custom
     FROM (SELECT ticker, name, market, eval_amount, pnl_pct FROM holdings WHERE quantity > 0
           UNION ALL SELECT ticker, name, 'ISA', eval_amount, pnl_pct FROM isa_holdings WHERE quantity > 0) h
     LEFT JOIN stock_sectors s ON s.ticker = h.ticker`,
  ).then((r) => r.length ? r : safe<Row>("SELECT ticker, name, market, eval_amount, pnl_pct, NULL AS auto, NULL AS custom FROM holdings WHERE quantity > 0"));
  const cash = await safe<{ market: string; deposit: string; d2_deposit: string | null }>(
    "SELECT market, deposit, d2_deposit FROM cash_balances UNION ALL SELECT 'ISA', deposit, d2_deposit FROM isa_cash",
  );
  const [saved] = await safe<{ value: Limits }>("SELECT value FROM app_settings WHERE key = 'weight_limits'");
  const limits = { ...DEFAULT_LIMITS, ...(saved?.value ?? {}) };
  const left = (m: string) => { const c = cash.find((x) => x.market === m); return c ? Number(c.d2_deposit ?? c.deposit) : 0; };
  const rate = await usdKrw();

  const holdings: HoldingIn[] = rows.map((r) => ({
    ticker: r.ticker, name: r.name, market: r.market, evalAmount: Number(r.eval_amount), pnlPct: Number(r.pnl_pct), sector: r.custom || r.auto || null,
  }));
  const w = weights(holdings, rate, left("KR") + left("ISA"), left("US"));
  const warnings = breaches(w, limits);
  const missingRate = rate === 0 && (holdings.some((h) => h.market === "US") || left("US") > 0);

  return (
    <>
      <div className="board-head">
        <h1>포트폴리오</h1>
        <nav className="segment" aria-label="포트폴리오 보기">
          <Link href="/">보유 종목</Link>
          <Link href="/weights" aria-current="page">비중</Link>
        </nav>
      </div>

      {holdings.length === 0 ? (
        <p className="muted">아직 보유 종목이 없어요. 워커가 키움 잔고를 불러오면 비중을 계산해요.</p>
      ) : (
        <>
          {warnings.length > 0 ? (
            <div className="callout">{warnings.map((t) => <div key={t}>{t}</div>)}</div>
          ) : (
            <div className="callout ok">정해 둔 한도 안이에요. 한 업종 최대 {limits.sectorMax}%, 한 종목 최대 {limits.stockMax}%, 현금 최소 {limits.cashMin}%.</div>
          )}
          {missingRate && <p className="muted">환율을 아직 못 받아서 미국 종목이 0원으로 계산됐어요. 미국장 잔고를 한 번 불러오면 바로 맞춰져요.</p>}
          <div className="donuts">
            <Donut title="업종" parts={slices(w.sectors, "그 밖 업종")} center={`${w.sectors.filter((s) => s.key !== CASH).length}개 업종`} />
            <Donut title={w.markets.some((m) => m.key === "ISA") ? "국내 · ISA · 해외 · 현금" : "국내 · 해외 · 현금"} parts={w.markets.map((m) => ({ ...m, color: m.key === "KR" ? COLORS[0] : m.key === "ISA" ? COLORS[1] : m.key === "US" ? COLORS[2] : CASH_COLOR }))} center={krw(w.total)} />
            <Donut title="종목" parts={slices(w.stocks.map(({ key, label, amount, pct }) => ({ key: key === CASH ? CASH : key, label, amount, pct })), "그 밖 종목")} center={`${holdings.length}종목`} />
          </div>

          <div className="weights-bottom">
            <form action={saveLimits} className="panel limits-form">
              <div className="panel-title">내 비중 한도 <span className="muted">넘으면 위에 알려요</span></div>
              <label>한 업종 최대 (%)<input name="sectorMax" inputMode="decimal" defaultValue={limits.sectorMax} /></label>
              <label>한 종목 최대 (%)<input name="stockMax" inputMode="decimal" defaultValue={limits.stockMax} /></label>
              <label>현금 최소 (%)<input name="cashMin" inputMode="decimal" defaultValue={limits.cashMin} /></label>
              <button type="submit">저장</button>
            </form>
            <div className="panel flush">
              <div className="panel-title">종목별 업종 <span className="muted">국내는 키움, 미국은 Finnhub에서 자동으로 받아요. 바꾸고 싶으면 고쳐 쓰세요.</span></div>
              <div className="list">
                {w.stocks.filter((s) => s.market !== "CASH").map((s) => {
                  const ticker = s.key.replace(/^ISA:/, "");
                  const r = rows.find((x) => x.ticker === ticker)!;
                  return (
                    <form key={s.key} action={saveSector} className="list-item sector-row">
                      <input type="hidden" name="ticker" value={ticker} />
                      <input type="hidden" name="market" value={s.market === "US" ? "US" : "KR"} />
                      <span className="main"><b>{s.label}</b> <span className="muted num">{s.pct}%</span></span>
                      <input name="sector" defaultValue={r.custom ?? ""} placeholder={r.auto || "자동 이름 받는 중"} maxLength={30} aria-label={`${s.label} 업종`} />
                      <button type="submit" className="ghost">저장</button>
                    </form>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="muted">비중은 평가금액 기준이고, 미국 종목과 달러 예수금은 키움 환율로 원화로 바꿔 합쳐요. 예수금은 D+2 기준이에요. ISA 계좌도 함께 넣었고, ETF는 여러 종목 묶음이라 한 종목·업종 한도에서 빼요.</p>
        </>
      )}
    </>
  );
}
