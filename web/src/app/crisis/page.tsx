import Link from "next/link";
import { isWindow, manwon, pct, replay, scenarioOf, SCENARIOS, shock, WINDOWS, type Replay, type ShockResult } from "@/lib/crisis";
import { crisisPrinciples, loadCrisis, loadCrisisSeries } from "@/lib/crisisData";
import { usd, won } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACCOUNT = { KR: "일반", ISA: "ISA", US: "미국" } as const;
const price = (v: number, us: boolean) => (us ? usd(v) : `${won(Math.round(v))}`);
const cls = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");
const dot = (d: string) => d.replaceAll("-", ".");

function PortfolioNav() {
  return (
    <div className="board-head">
      <h1>포트폴리오</h1>
      <nav className="segment" aria-label="포트폴리오 보기">
        <Link href="/">보유 종목</Link>
        <Link href="/weights">비중</Link>
        <Link href="/daily">달력</Link>
        <Link href="/crisis" aria-current="page">위기 리허설</Link>
      </nav>
    </div>
  );
}

function ScenarioList({ on }: { on: string }) {
  const item = (id: string, icon: string, label: string, sub: string) => (
    <Link key={id} href={`/crisis?s=${id}`} className={`crisis-scn${id === on ? " on" : ""}`} aria-current={id === on ? "page" : undefined}>
      <span>{icon} {label}</span><span className="muted">{sub}</span>
    </Link>
  );
  return (
    <nav className="crisis-list" aria-label="상황 고르기">
      <div className="label">숫자로</div>
      {SCENARIOS.map((s) => item(s.id, s.icon, s.label, s.sub))}
      <div className="label">그때 그대로</div>
      {WINDOWS.map((w) => item(w.id, w.icon, w.label, w.sub))}
    </nav>
  );
}

function Principles({ items }: { items: string[] }) {
  return (
    <div className="panel crisis-rules">
      <div className="panel-title">📜 내 위기 대응 원칙 <Link href="/journal" className="muted">매매일지에서 고치기</Link></div>
      {items.length === 0 ? (
        <div className="muted">아직 없어요. 매매일지 위쪽 원칙 칸에서 "위기 대응 원칙"을 골라 적어 두면 여기 같이 보여요.</div>
      ) : (
        <ol>{items.map((p) => <li key={p}>{p}</li>)}</ol>
      )}
    </div>
  );
}

function ShockView({ r, label }: { r: ShockResult; label: string }) {
  const max = Math.max(1, ...r.rows.map((x) => Math.abs(x.change)), Math.abs(r.byAccount.cashFx));
  const usTotal = r.byAccount.usPrice + r.byAccount.usFx;
  const bars = [
    ...r.rows.map((x) => ({ key: x.ticker + x.account, name: x.account === "ISA" ? `${x.name} (ISA)` : x.name, v: x.change, note: x.betaKnown ? `베타 ${x.beta.toFixed(2)}` : "베타 모름 → 1" })),
    ...(Math.round(r.byAccount.cashFx) !== 0 ? [{ key: "usd-cash", name: "달러 예수금", v: r.byAccount.cashFx, note: "환율" }] : []),
  ];
  const stopRows = r.rows.filter((x) => x.stop !== null);
  return (
    <>
      <div className="panel crisis-total">
        <div>
          <div className="label">{label}면</div>
          <div className={`crisis-big ${cls(r.change)}`}>약 {manwon(r.change)} <small>{pct(r.pct)}</small></div>
          <div className="muted">지금 {manwon(r.before).replace("+", "")} → 약 {manwon(r.after).replace("+", "")}</div>
        </div>
        <dl>
          <dt>일반</dt><dd className={cls(r.byAccount.KR)}>{manwon(r.byAccount.KR)}</dd>
          <dt>ISA</dt><dd className={cls(r.byAccount.ISA)}>{manwon(r.byAccount.ISA)}</dd>
          <dt>미국</dt>
          <dd className={cls(usTotal)}>{manwon(usTotal)}{Math.round(r.byAccount.usFx) !== 0 && <span className="muted"> (환율 몫 {manwon(r.byAccount.usFx)})</span>}</dd>
        </dl>
        <dl>
          <dt>현금 비중</dt><dd>{r.cashBefore.toFixed(1)}% → {r.cashAfter.toFixed(1)}%</dd>
          <dt>손절가 닿음</dt><dd className={r.hits.length ? "up" : ""}>{r.hits.length}종목</dd>
          {r.rateAfter !== r.rate && <><dt>환율</dt><dd>{won(Math.round(r.rate))} → {won(Math.round(r.rateAfter))}원</dd></>}
        </dl>
      </div>
      <div className="crisis-two">
        <div className="panel">
          <div className="panel-title">종목별로 얼마</div>
          {bars.length === 0 ? <div className="muted">보유 종목이 없어요.</div> : bars.map((b) => (
            <div className="crisis-bar" key={b.key}>
              <span className="n" title={b.note}>{b.name}</span>
              <span className="track"><i className={b.v < 0 ? "down" : "up"} style={{ width: `${(Math.abs(b.v) / max) * 100}%` }} /></span>
              <b className={cls(b.v)}>{manwon(b.v)}</b>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel-title">손절가에 닿는 종목</div>
          {stopRows.length === 0 ? (
            <div className="muted">켜 둔 손절 알림이 없어요. 매수 일지를 쓰면 손절가가 알림으로 생겨요.</div>
          ) : (
            <table className="crisis-table">
              <thead><tr><th>종목</th><th>지금</th><th>이렇게 되면</th><th>손절가</th><th /></tr></thead>
              <tbody>
                {stopRows.map((x) => {
                  const us = x.account === "US";
                  return (
                    <tr key={x.ticker + x.account}>
                      <td><Link href={`/stock/${encodeURIComponent(x.ticker)}`}>{x.name}</Link></td>
                      <td className="num">{price(x.priceAfter / x.ratio, us)}</td>
                      <td className="num">{price(x.priceAfter, us)}</td>
                      <td className="num">{price(x.stop!, us)}</td>
                      <td>{x.hit ? <span className="badge up">닿음</span> : <span className="muted">안 닿음</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="muted crisis-note">
        종목마다 지난 1년 동안 {"시장(국내는 코스피, 미국은 나스닥)"}보다 얼마나 더 움직였는지(베타)를 곱한 어림이에요.
        {r.guessed > 0 && ` 일봉이 모자란 ${r.guessed}종목은 시장과 똑같이(베타 1) 움직인다고 쳤어요.`}
        {" "}다른 시장·환율은 그대로 둔 계산이고, 예측이 아니에요.
      </p>
    </>
  );
}

function Chart({ r }: { r: Replay }) {
  const W = 760, H = 300, P = 14;
  const vals = r.points.flatMap((p) => [p.mine, p.kospi ?? p.mine]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i: number) => (i * (W - 2 * P)) / Math.max(1, r.points.length - 1) + P;
  const y = (v: number) => P + ((hi - v) / span) * (H - 2 * P);
  const line = (get: (i: number) => number | null) => r.points.map((_, i) => get(i)).map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const ti = r.points.findIndex((p) => p.day === r.troughDay);
  return (
    <svg className="crisis-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="내 계좌와 코스피 흐름">
      <line x1={P} x2={W - P} y1={y(r.start)} y2={y(r.start)} className="base" />
      <polyline points={line((i) => r.points[i].kospi)} className="kospi" />
      <polyline points={line((i) => r.points[i].mine)} className="mine" />
      {ti >= 0 && (
        <>
          <circle cx={x(ti)} cy={y(r.points[ti].mine)} r={5} className="trough" />
          <text x={Math.min(x(ti) + 8, W - 150)} y={y(r.points[ti].mine) + 16} className="trough-t">바닥 {pct(r.troughPct, 0)} · {dot(r.troughDay).slice(5)}</text>
        </>
      )}
    </svg>
  );
}

function ReplayView({ r, w }: { r: Replay | null; w: (typeof WINDOWS)[number] }) {
  if (!r) {
    return (
      <div className="panel muted">
        {w.label} 일봉을 아직 못 받았어요. 워커가 업데이트된 뒤 몇 분 안에 야후에서 받아 와요(코스피·나스닥·환율과 보유 종목, 그 구간만).
      </div>
    );
  }
  const last = r.points[r.points.length - 1];
  return (
    <>
      <div className="crisis-replay">
        <div className="panel">
          <div className="panel-title">
            지금 계좌로 {w.label}을 다시 겪는다면
            <span className="muted"><span className="gold">━</span> 내 종목 <span className="crisis-k">━</span> 코스피</span>
          </div>
          <Chart r={r} />
          <div className="crisis-axis muted"><span>{dot(r.points[0].day)}</span><span>{dot(last.day)}</span></div>
        </div>
        <div className="crisis-kpis">
          <div className="kpi"><div className="label">가장 깊을 때</div><div className={`v ${cls(r.troughPct)}`}>{pct(r.troughPct)}</div><div className="s">약 {manwon(r.troughWon)}</div></div>
          <div className="kpi">
            <div className="label">원래대로 오기까지</div>
            <div className="v">{r.recoverDays === null ? "못 옴" : `${r.recoverDays}일`}</div>
            <div className="s">{r.kospiRecoverDays === null ? "코스피도 못 옴" : `코스피는 ${r.kospiRecoverDays}일`}{r.recoverDays === null ? ` · ${dot(w.end)}까지 봤어요` : ""}</div>
          </div>
          <div className="kpi"><div className="label">하루 최악</div><div className={`v ${cls(r.worstPct)}`}>{pct(r.worstPct)}</div><div className="s">{dot(r.worstDay)}</div></div>
          <div className="kpi"><div className="label">손절가 닿음</div><div className="v">{r.hits.length}종목</div><div className="s">{r.hits.map((h) => h.name).slice(0, 3).join(" · ") || "없어요"}</div></div>
        </div>
      </div>
      <div className="warn">
        {r.hits.length > 0
          ? <>손절가대로 다 팔았다면 {dot(w.shown)}에 <b>{pct(r.soldEndPct)}</b>, 그대로 들고 있었다면 <b>{pct(r.heldEndPct)}</b>예요. 어느 쪽이 내 원칙인지 미리 정해 두세요.</>
          : <>지금 손절가로는 이 구간에서 판 종목이 없어요. 그대로 들고 있었다면 {dot(w.shown)}에 <b>{pct(r.heldEndPct)}</b>예요.</>}
      </div>
      <p className="muted crisis-note">
        지금 들고 있는 종목과 예수금을 그 구간에 그대로 넣어 본 계산이에요.
        {r.proxies.length > 0 && ` 그 구간 일봉이 없는 ${r.proxies.join(", ")}은(그때 상장 전이거나 아직 못 받음) 시장 지수 × 베타로 대신 계산했어요.`}
        {r.fxKnown ? " 미국 종목과 달러는 그때 환율 움직임도 넣었어요." : " 그때 환율을 못 받아서 환율은 그대로 뒀어요."}
      </p>
    </>
  );
}

export default async function CrisisPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const sc = scenarioOf((await searchParams).s);
  const { holdings, cash, rate } = await loadCrisis();
  const principles = await crisisPrinciples();
  let body;
  if (isWindow(sc)) {
    const series = await loadCrisisSeries(holdings.map((h) => h.ticker));
    body = <ReplayView r={holdings.length || cash.krw || cash.usd ? replay(holdings, cash, rate, series, sc) : null} w={sc} />;
  } else {
    body = holdings.length === 0 && !cash.krw && !cash.usd
      ? <div className="panel muted">아직 잔고를 불러오지 않았어요.</div>
      : <ShockView r={shock(holdings, cash, rate, sc)} label={sc.label} />;
  }
  return (
    <>
      <PortfolioNav />
      <div className="crisis">
        <aside><ScenarioList on={sc.id} /></aside>
        <div className="crisis-main">
          {body}
          <Principles items={principles} />
        </div>
      </div>
    </>
  );
}
