import Link from "next/link";
import { deleteLabRule, rerunLabRule } from "@/app/actions";
import { query } from "@/lib/db";
import { signClass } from "@/lib/format";
import { encodeGame } from "@/lib/practice";
import { summarize, type Sale } from "@/lib/stats";
import {
  BIG_LOSS, binIsLoss, binLabels, chartWindow, closestRule, cleanRule, describe, DUEL_SORTS, edge, filterTrades, marketLabel, pct, sortDuel,
  TRADE_FILTERS, tradeKey, type DuelSort, type LabRule, type Result, type TradeFilter,
} from "@/lib/lab";
import WatchTabs from "../../WatchTabs";
import PracticeTabs from "../PracticeTabs";
import LabBuilder from "./LabBuilder";
import LabPoller from "./LabPoller";
import LabTradeChart from "./LabTradeChart";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);
const DUEL_MAX = 4;
const PAGE = 40;

type Row = { id: number; name: string; rule: unknown; status: LabRule["status"]; error: string | null; result: Result | null; done_at: string | null };
type Sp = { r?: string; v?: string; f?: string; t?: string; n?: string; s?: string; p?: string; new?: string };

export default async function LabPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const rows = await safe<Row>(
    `SELECT id, name, rule, status, error, result, to_char(done_at AT TIME ZONE 'Asia/Seoul', 'MM.DD HH24:MI') AS done_at
     FROM lab_rules ORDER BY created_at, id`,
  );
  const rules: LabRule[] = rows.map((r) => ({ id: r.id, name: r.name, rule: cleanRule(r.rule).rule, status: r.status, error: r.error, result: r.result, doneAt: r.done_at }));
  const [pool] = await safe<{ kr: string; us: string }>(
    `SELECT count(DISTINCT p.ticker) FILTER (WHERE p.market = 'KR') AS kr, count(DISTINCT p.ticker) FILTER (WHERE p.market = 'US') AS us
     FROM practice_pool p WHERE EXISTS (SELECT 1 FROM price_history h WHERE h.ticker = p.ticker)`,
  );
  const counts = { KR: Number(pool?.kr ?? 0), US: Number(pool?.us ?? 0) };
  const waiting = rules.filter((r) => r.status === "queued" || r.status === "running").map((r) => r.id);
  const duel = sp.v === "duel";

  return (
    <>
      <div className="board-head">
        <h1>관심종목</h1>
        <WatchTabs on="practice" />
      </div>
      <PracticeTabs on="lab" />
      {waiting.length > 0 && <LabPoller ids={waiting} />}
      <div className="lab-views">
        <nav className="segment" aria-label="실험실 보기">
          <Link href="/watch/practice/lab" aria-current={!duel ? "page" : undefined}>규칙 만들기</Link>
          <Link href="/watch/practice/lab?v=duel" aria-current={duel ? "page" : undefined}>규칙 대결{rules.length > 0 && <span className="muted lab-count">{rules.length}</span>}</Link>
        </nav>
        <span className="muted lab-small">연습용 종목 국내 {counts.KR} · 미국 {counts.US}개의 일봉(최대 5년)으로 돌려요</span>
      </div>
      {duel ? <Duel rules={rules} sp={sp} /> : <Build rules={rules} sp={sp} counts={counts} />}
      <p className="muted lab-small lab-foot">
        과거에 이랬다는 계산이에요. 앞으로도 그렇다는 뜻은 아니에요. 매매 한 번마다 수수료·세금 0.3%를 빼고, 조건이 맞은 다음 날 시가에 샀다고 쳐요(시가가 없는 날은 종가).
        손절·익절은 장중 저가·고가로 보고 같은 날 둘 다 닿으면 손절로, 갭이면 시가로 쳐요. 연습용 종목은 지금 큰 회사들이라 결과가 실제보다 좋게 나올 수 있어요.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- 규칙 만들기 + 결과 + 거래
async function Build({ rules, sp, counts }: { rules: LabRule[]; sp: Sp; counts: { KR: number; US: number } }) {
  const fresh = "new" in sp || rules.length === 0;
  const sel = fresh ? null : rules.find((r) => String(r.id) === sp.r) ?? rules.at(-1)!;
  const base = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    if (sel) p.set("r", String(sel.id));
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v); else p.delete(k);
    return `/watch/practice/lab?${p}`;
  };
  return (
    <div className="lab-grid">
      <div className="lab-left">
        <LabBuilder key={sel?.id ?? "new"} id={sel?.id ?? null} name={sel?.name ?? ""} rule={sel?.rule ?? null} counts={counts} />
        {rules.length > 0 && (
          <section className="panel lab-saved">
            <div className="lab-saved-head"><h2>저장한 규칙 비교</h2><Link className="lab-small" href="/watch/practice/lab?new=1">＋ 새 규칙</Link></div>
            <div className="table-wrap">
              <table className="lab-table">
                <thead><tr><th>규칙</th><th>거래</th><th>이긴 비율</th><th>평균</th><th>최대 손실</th><th>들고 있기 대비</th></tr></thead>
                <tbody>
                  {rules.map((r) => {
                    const x = r.result;
                    const e = x ? edge(x) : null;
                    return (
                      <tr key={r.id} className={r.id === sel?.id ? "on" : undefined}>
                        <td><Link href={`/watch/practice/lab?r=${r.id}`}>{r.name}</Link></td>
                        {r.status !== "done" || !x ? <td colSpan={5} className="muted">{statusWord(r)}</td> : (
                          <>
                            <td>{x.n.toLocaleString()}</td><td>{x.winPct === null ? "-" : `${x.winPct}%`}</td>
                            <td className={signClass(x.avg ?? 0)}>{pct(x.avg)}</td><td className="down">{pct(x.worst)}</td>
                            <td className={signClass(e ?? 0)}>{e === null ? "-" : `${e > 0 ? "+" : e < 0 ? "−" : ""}${Math.abs(e).toFixed(1)}%p`}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      <div className="lab-right">
        {sel ? <ResultPanel rule={sel} sp={sp} href={base} /> : (
          <section className="panel lab-empty">
            <h2>규칙을 실험해 보세요</h2>
            <p className="muted">왼쪽에서 살 때·팔 때 조건을 고르고 <b>돌려 보기</b>를 누르면, 연습용 종목들의 지난 일봉에서 그 규칙대로 사고팔았을 때 결과가 여기에 나와요.</p>
            <p className="muted">말로 적고 ✨ 칸 채우기를 눌러도 돼요. 예: &quot;20일선 위에서 RSI 30 아래로 떨어지면 사고, −7%나 +15%면 판다&quot;</p>
          </section>
        )}
      </div>
    </div>
  );
}

function statusWord(r: LabRule): string {
  if (r.status === "queued") return "돌릴 차례를 기다려요…";
  if (r.status === "running") return "돌리는 중…";
  if (r.status === "error") return `못 돌렸어요: ${r.error ?? ""}`;
  return "아직 결과가 없어요";
}

async function ResultPanel({ rule, sp, href }: { rule: LabRule; sp: Sp; href: (q: Record<string, string | undefined>) => string }) {
  const d = describe(rule.rule);
  const x = rule.result;
  const head = (
    <div className="lab-res-head">
      <h2>{rule.name}</h2>
      <span className="muted lab-small">{d.buy.join(" + ")} → {d.sell.join(" · ")} · {marketLabel(rule.rule.market)} · {rule.rule.years}년</span>
      <span className="lab-res-tools">
        <form action={rerunLabRule.bind(null, rule.id)}><button className="ghost" type="submit">↻ 다시 돌리기</button></form>
        <form action={deleteLabRule.bind(null, rule.id)}><button className="ghost" type="submit">지우기</button></form>
      </span>
    </div>
  );
  if (rule.status !== "done" || !x) {
    return <section className="panel lab-res">{head}<p className={rule.status === "error" ? "practice-warn" : "muted"}>{statusWord(rule)}{rule.status !== "error" && " 1~2분 걸려요. 끝나면 이 화면이 저절로 바뀌어요."}</p></section>;
  }
  const e = edge(x);
  const f: TradeFilter = TRADE_FILTERS.find((k) => k.key === sp.f)?.key ?? "all";
  const all = x.trades ?? [];
  const list = filterTrades(all, f);
  const shown = Math.max(PAGE, Math.min(Number(sp.n) || PAGE, list.length));
  const picked = list.find((t) => tradeKey(t) === sp.t) ?? list[0];
  let chart = null;
  if (picked) {
    const bars = (await safe<{ day: string; open: string | null; high: string | null; low: string | null; close: string; volume: string | null }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close, volume FROM price_history
       WHERE ticker = $1 AND day BETWEEN $2::date - 140 AND $3::date + 60 ORDER BY day`, [picked.t, picked.b, picked.s],
    )).map((r) => { const c = Number(r.close); return { day: r.day, open: Number(r.open ?? c), high: Number(r.high ?? c), low: Number(r.low ?? c), close: c, volume: r.volume === null ? null : Number(r.volume) }; });
    const [a, b] = chartWindow(bars.map((r) => r.day), picked.b, picked.s);
    chart = { bars: bars.slice(a, b), from: bars[a]?.day };
  }
  const stopPx = picked && rule.rule.sell.stop ? picked.bp * (1 - rule.rule.sell.stop / 100) : null;
  const targetPx = picked && rule.rule.sell.target ? picked.bp * (1 + rule.rule.sell.target / 100) : null;

  return (
    <>
      <section className="panel lab-res">
        {head}
        <p className="muted lab-small">{x.since?.replaceAll("-", ".")} ~ {x.until?.replaceAll("-", ".")} · {x.tickers ?? 0}종목{rule.doneAt && ` · ${rule.doneAt}에 돌림`}</p>
        {x.n === 0 ? <p className="muted">이 기간에 조건이 맞은 날이 한 번도 없었어요. 조건을 줄이거나 기간을 늘려 보세요.</p> : (
          <>
            <div className="lab-kpis">
              <Kpi label="거래" value={`${x.n.toLocaleString()}번`} sub={x.tickers ? `종목당 ${(x.n / x.tickers).toFixed(1)}번` : ""} />
              <Kpi label="이긴 비율" value={`${x.winPct}%`} sub={`${x.wins.toLocaleString()}번 수익`} />
              <Kpi label="평균 수익" value={pct(x.avg)} cls={signClass(x.avg ?? 0)} sub={`이길 때 ${pct(x.avgWin)} · 질 때 ${pct(x.avgLoss)}`} />
              <Kpi label="가장 크게 잃은 한 번" value={pct(x.worst)} cls="down" sub={`가장 크게 번 한 번 ${pct(x.best)}`} />
              <Kpi label="평균 보유" value={`${x.avgDays}일`} sub="거래일 기준" />
              <Kpi label="그냥 들고 있었다면" value={pct(x.hold)} cls={signClass(x.hold ?? 0)} sub={`같은 날 사서 20일 · 규칙이 ${e === null ? "-" : `${e >= 0 ? "+" : "−"}${Math.abs(e).toFixed(1)}%p`}`} />
            </div>
            <h3 className="lab-h3">한 번 거래 수익 분포</h3>
            <Hist r={x} />
          </>
        )}
      </section>

      {all.length > 0 && (
        <section className="panel lab-trades">
          <div className="lab-trades-head">
            <h2>거래 하나씩 보기</h2>
            <nav className="segment" aria-label="거래 고르기">
              {TRADE_FILTERS.map((k) => <Link key={k.key} href={href({ f: k.key === "all" ? undefined : k.key })} aria-current={k.key === f ? "page" : undefined}>{k.label}</Link>)}
            </nav>
          </div>
          <div className="lab-trades-body">
            <div className="lab-trade-list">
              {list.length === 0 ? <p className="muted">{f === "big" ? `${BIG_LOSS}% 넘게 잃은 거래가 없어요.` : "해당하는 거래가 없어요."}</p> : (
                <table className="lab-table">
                  <thead><tr><th>종목</th><th>산 날</th><th>수익</th><th>보유 · 왜 팔았나</th></tr></thead>
                  <tbody>
                    {list.slice(0, shown).map((t) => (
                      <tr key={tradeKey(t)} className={picked && tradeKey(t) === tradeKey(picked) ? "on" : undefined}>
                        <td><Link href={href({ f: f === "all" ? undefined : f, n: sp.n, t: tradeKey(t) })} scroll={false}>{t.n || t.t}</Link></td>
                        <td>{t.b.slice(2).replaceAll("-", ".")}</td>
                        <td className={signClass(t.r)}>{pct(t.r)}</td><td className="muted">{t.d}일 · {t.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted lab-small">
                {(x.kept ?? all.length) < x.n ? `거래가 많아서 크게 잃고 번 거래와 최근 거래 ${all.length.toLocaleString()}개만 남겼어요. ` : ""}
                {list.length > shown ? <Link href={href({ f: f === "all" ? undefined : f, n: String(shown + PAGE), t: sp.t })} scroll={false}>더 보기 ({(list.length - shown).toLocaleString()}개)</Link> : `${list.length.toLocaleString()}개`}
              </p>
            </div>
            <div className="lab-trade-chart">
              {picked && chart && chart.bars.length > 1 ? (
                <>
                  <div className="lab-chart-head">
                    <b>{picked.n || picked.t}</b>
                    <span className="muted">{picked.b.replaceAll("-", ".")} 삼 → {picked.s.replaceAll("-", ".")} 팜 · <span className={signClass(picked.r)}>{pct(picked.r)}</span> · {picked.why}</span>
                  </div>
                  <LabTradeChart bars={chart.bars} market={picked.m} buy={{ day: picked.b, price: picked.bp }} sell={{ day: picked.s, price: picked.sp }} stop={stopPx} target={targetPx} />
                  {chart.from && (
                    <p className="lab-small"><Link href={`/watch/practice?g=${encodeGame({ ticker: picked.t, start: picked.b, blind: false })}`}>이 거래를 연습하기에서 직접 해 보기 →</Link></p>
                  )}
                </>
              ) : <p className="muted">거래를 누르면 그 종목 차트에 산 곳과 판 곳이 보여요.</p>}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className={`stat-value ${cls ?? ""}`}>{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

function Hist({ r, small }: { r: Result; small?: boolean }) {
  const hist = r.hist ?? [];
  const bins = r.bins ?? [];
  if (!hist.length || !bins.length) return null;
  const labels = binLabels(bins);
  const max = Math.max(1, ...hist);
  const W = small ? 220 : 640, H = small ? 64 : 160, pad = small ? 2 : 24;
  const bw = W / hist.length;
  return (
    <svg className={small ? "lab-hist small" : "lab-hist"} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="한 번 거래 수익 분포">
      {hist.map((v, k) => {
        const h = (v / max) * (H - pad - 4);
        return (
          <rect key={k} x={k * bw + bw * 0.12} y={H - pad - h} width={bw * 0.76} height={Math.max(h, v ? 1 : 0)} rx={2} className={binIsLoss(bins, k) ? "loss" : "gain"}>
            <title>{`${labels[k]}: ${v.toLocaleString()}번`}</title>
          </rect>
        );
      })}
      {!small && [0, Math.floor(bins.length / 2), bins.length].map((k) => (
        <text key={k} x={k * bw} y={H - 4} className="lab-hist-label" textAnchor={k === 0 ? "start" : k === bins.length ? "end" : "middle"}>{k === 0 ? `${bins[0]}%` : `${bins[k - 1] > 0 ? "+" : ""}${bins[k - 1]}%`}</text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- 규칙 대결
async function Duel({ rules, sp }: { rules: LabRule[]; sp: Sp }) {
  const by: DuelSort = DUEL_SORTS.find((s) => s.key === sp.s)?.key ?? "avg";
  const done = rules.filter((r) => r.status === "done" && r.result && r.result.n > 0);
  if (done.length === 0) {
    return <section className="panel"><p className="muted">결과가 나온 규칙이 아직 없어요. 규칙 만들기에서 규칙을 두 개 넘게 돌리면 여기서 나란히 비교할 수 있어요.</p></section>;
  }
  const want = (sp.p ?? "").split(",").map(Number).filter(Boolean);
  const chosen = want.length ? done.filter((r) => want.includes(r.id)).slice(0, DUEL_MAX) : sortDuel(done, by).slice(0, DUEL_MAX);
  const cols = sortDuel(chosen, by);
  const best = cols[0];
  const ids = cols.map((r) => r.id);
  const link = (q: { s?: DuelSort; p?: number[] }) => {
    const p = new URLSearchParams({ v: "duel" });
    const s = q.s ?? by;
    if (s !== "avg") p.set("s", s);
    const pick = q.p ?? (want.length ? ids : []);
    if (pick.length) p.set("p", pick.join(","));
    return `/watch/practice/lab?${p}`;
  };
  const toggle = (id: number) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-DUEL_MAX));

  const sales = await safe<{ return_pct: string; holding_days: number }>("SELECT return_pct, holding_days FROM sell_entries WHERE return_pct IS NOT NULL");
  const mine = summarize(sales.map((s) => ({ returnPct: Number(s.return_pct), holdingDays: s.holding_days }) as Sale));
  const near = closestRule(done, mine);

  return (
    <>
      <div className="lab-duel-tools">
        <span className="muted lab-small">같은 종목 · 같은 방식으로 돌린 결과예요. 이름을 눌러 칸에 넣고 빼요(최대 {DUEL_MAX}개).</span>
        <nav className="segment" aria-label="줄 세우기">
          {DUEL_SORTS.map((s) => <Link key={s.key} href={link({ s: s.key })} aria-current={s.key === by ? "page" : undefined}>{s.label}</Link>)}
        </nav>
      </div>
      <div className="lab-picks">
        {done.map((r) => <Link key={r.id} className={ids.includes(r.id) ? "chip-btn on" : "chip-btn"} href={link({ p: toggle(r.id).length ? toggle(r.id) : ids })}>{ids.includes(r.id) ? "✓ " : "＋ "}{r.name}</Link>)}
      </div>
      <div className="lab-duel">
        {cols.map((r) => {
          const x = r.result!;
          const e = edge(x);
          const d = describe(r.rule);
          return (
            <section key={r.id} className={r === best && cols.length > 1 ? "panel lab-col best" : "panel lab-col"}>
              <div className="lab-col-head"><Link href={`/watch/practice/lab?r=${r.id}`}><b>{r.name}</b></Link>{r === best && cols.length > 1 && <span className="gold"> 🏆</span>}</div>
              <p className="muted lab-small">{d.buy.join(" + ")} → {d.sell.join(" · ")} · {marketLabel(r.rule.market)} {r.rule.years}년</p>
              <div className="lab-col-row"><span className="muted">이긴 비율</span><b className="lab-big">{x.winPct}%</b></div>
              <div className="habit-track"><i style={{ width: `${x.winPct ?? 0}%`, background: "var(--accent)" }} /></div>
              <div className="lab-col-row"><span className="muted">평균</span><b className={signClass(x.avg ?? 0)}>{pct(x.avg)}</b></div>
              <div className="lab-col-row"><span className="muted">최대 손실</span><b className="down">{pct(x.worst)}</b></div>
              <div className="lab-col-row"><span className="muted">거래 · 보유</span><span>{x.n.toLocaleString()}번 · {x.avgDays}일</span></div>
              <div className="lab-col-row"><span className="muted">들고 있기 대비</span><b className={signClass(e ?? 0)}>{e === null ? "-" : `${e >= 0 ? "+" : "−"}${Math.abs(e).toFixed(1)}%p`}</b></div>
              <Hist r={x} small />
            </section>
          );
        })}
      </div>
      <section className="panel lab-read">
        <h2>🔍 해석</h2>
        <p>{readDuel(cols)}</p>
        <p>
          {mine.count === 0 || !near ? <span className="muted">매매일지에 매도 기록이 쌓이면 내 실제 매매가 어느 규칙과 닮았는지도 알려 드려요.</span>
            : <>내 실제 매매(매도 {mine.count}번 · 이긴 비율 {mine.winRate}% · 평균 {pct(mine.avgReturn)})는 <b className="gold">{near.name}</b>와 닮았어요
              {near.result && ` (이긴 비율 ${near.result.winPct}% · 평균 ${pct(near.result.avg)})`}.</>}
        </p>
      </section>
    </>
  );
}

/** 칸끼리 한 줄 비교: 자주 이기는 규칙 vs 크게 이기는 규칙 */
function readDuel(cols: LabRule[]): string {
  if (cols.length < 2) return "규칙을 하나 더 돌리면 서로 어떻게 다른지 비교해 드려요.";
  const often = [...cols].sort((a, b) => (b.result!.winPct ?? 0) - (a.result!.winPct ?? 0))[0];
  const big = [...cols].sort((a, b) => (b.result!.avgWin ?? 0) - (a.result!.avgWin ?? 0))[0];
  const safe = [...cols].sort((a, b) => (b.result!.worst ?? -999) - (a.result!.worst ?? -999))[0];
  const parts = [];
  if (often === big) parts.push(`${often.name}는 자주 이기고 이길 때도 크게 이겨요.`);
  else parts.push(`${often.name}는 자주 이기고(${often.result!.winPct}%), ${big.name}는 덜 이기지만 이길 때 크게 이겨요(이긴 거래 평균 ${pct(big.result!.avgWin)}).`);
  parts.push(`한 번에 가장 덜 잃은 건 ${safe.name}예요(최대 손실 ${pct(safe.result!.worst)}).`);
  return parts.join(" ");
}
