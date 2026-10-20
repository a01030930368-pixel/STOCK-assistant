import Link from "next/link";
import { query } from "@/lib/db";
import { today, won } from "@/lib/format";
import { byRules, monthly, since, summarize, type Sale, type Summary } from "@/lib/stats";
import { loadBooks, loadReviews } from "@/lib/booksData";
import { lessons, summarizeReviews, type Reviewed, type ReviewSummary } from "@/lib/reviews";
import JournalTabs from "../JournalTabs";

export const dynamic = "force-dynamic";

type Row = {
  position_id: number; trade_date: string; ticker: string; name: string; return_pct: string; holding_days: number;
  reason_type: Sale["reasonType"]; followed_rules: boolean; lesson: string;
};
const RANGES = [{ key: "1m", label: "1개월", months: 1 }, { key: "3m", label: "3개월", months: 3 }, { key: "6m", label: "6개월", months: 6 }, { key: "all", label: "전체", months: null }] as const;
const REASON = { stop: "손절", target: "익절", other: "기타" };

const sp = (v: number | null, digits = 1) => (v === null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
const cls = (v: number | null) => (v === null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");

function Tiles({ s }: { s: Summary }) {
  return (
    <div className="stats five">
      <div className="stat"><div className="stat-label">승률</div><div className="stat-value">{s.winRate === null ? "-" : `${s.winRate}%`}</div><div className="stat-sub">{s.count}번 중 {s.wins}번 수익</div></div>
      <div className="stat"><div className="stat-label">평균 수익</div><div className={`stat-value ${cls(s.avgWin)}`}>{sp(s.avgWin)}</div><div className="stat-sub">수익 낸 {s.wins}번</div></div>
      <div className="stat"><div className="stat-label">평균 손실</div><div className={`stat-value ${cls(s.avgLoss)}`}>{sp(s.avgLoss)}</div><div className="stat-sub">손실 본 {s.count - s.wins}번</div></div>
      <div className="stat"><div className="stat-label">손익비</div><div className="stat-value">{s.payoff ?? "-"}</div><div className="stat-sub">평균 수익 ÷ 평균 손실</div></div>
      <div className="stat"><div className="stat-label">평균 보유</div><div className="stat-value">{s.avgDays === null ? "-" : `${s.avgDays}일`}</div><div className="stat-sub">수익 {s.avgDaysWin ?? "-"}일 · 손실 {s.avgDaysLoss ?? "-"}일</div></div>
    </div>
  );
}

// 월별 평균 수익률 막대. 0선 위는 빨강(수익), 아래는 파랑(손실).
function MonthBars({ data }: { data: ReturnType<typeof monthly> }) {
  const W = 560, H = 190, mid = 88, half = 70;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.avgReturn ?? 0)));
  const bw = W / data.length;
  return (
    <svg className="month-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 평균 실현 수익률">
      <line x1="0" x2={W} y1={mid} y2={mid} className="axis" />
      {data.map((d, i) => {
        const v = d.avgReturn ?? 0;
        const h = Math.max(d.count ? 2 : 0, (Math.abs(v) / max) * half);
        const x = i * bw + bw * 0.3, y = v >= 0 ? mid - h : mid;
        return (
          <g key={d.month}>
            <title>{`${d.month} · ${d.count}번 · ${d.avgReturn === null ? "매도 없음" : sp(d.avgReturn, 2)}`}</title>
            <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
            {d.count > 0 && <rect x={x} y={y} width={bw * 0.4} height={h} rx="3" className={v >= 0 ? "up" : "down"} />}
            <text x={x + bw * 0.2} y={v >= 0 ? y - 6 : y + h + 14} textAnchor="middle" className="val">{d.count ? sp(d.avgReturn) : ""}</text>
            <text x={x + bw * 0.2} y={H - 6} textAnchor="middle" className="lab">{Number(d.month.slice(5))}월</text>
          </g>
        );
      })}
    </svg>
  );
}

function Side({ title, s, on }: { title: string; s: Summary; on?: boolean }) {
  return (
    <div className={on ? "panel rules-side on" : "panel rules-side"}>
      <div className="panel-title">{title} <span className="muted">{s.count}번</span></div>
      <div className="stats three">
        <div className="stat"><div className="stat-label">승률</div><div className="stat-value">{s.winRate === null ? "-" : `${s.winRate}%`}</div></div>
        <div className="stat"><div className="stat-label">평균 수익률</div><div className={`stat-value ${cls(s.avgReturn)}`}>{sp(s.avgReturn)}</div></div>
        <div className="stat"><div className="stat-label">가장 큰 손실</div><div className={`stat-value ${cls(s.worst !== null && s.worst < 0 ? s.worst : null)}`}>{s.worst !== null && s.worst < 0 ? sp(s.worst) : "-"}</div></div>
      </div>
    </div>
  );
}

type FeeRow = { fee: string | null; amount: string | null; fills: string; us_fills: string };

// 키움 체결에서 받은 수수료·세금. 미국 체결 조회(ust21180)는 수수료를 주지 않아 국내만 합칩니다.
async function feeTotals(months: number | null): Promise<FeeRow> {
  const [row] = await query<FeeRow>(
    `SELECT sum(fee) FILTER (WHERE market = 'KR') AS fee, sum(quantity * price) FILTER (WHERE market = 'KR' AND fee IS NOT NULL) AS amount,
       count(*) FILTER (WHERE market = 'KR' AND fee IS NOT NULL) AS fills, count(*) FILTER (WHERE market = 'US') AS us_fills
     FROM trade_fills WHERE $1::int IS NULL OR trade_date > CURRENT_DATE - make_interval(months => $1::int)`,
    [months],
  ).catch(() => []);
  return row ?? { fee: null, amount: null, fills: "0", us_fills: "0" };
}

function Fees({ f, label }: { f: FeeRow; label: string }) {
  const fee = Number(f.fee ?? 0), amount = Number(f.amount ?? 0);
  return (
    <div className="stats three fee-tiles">
      <div className="stat"><div className="stat-label">수수료·세금 <span className="muted">국내 · {label}</span></div><div className="stat-value">{won(fee)}원</div><div className="stat-sub">키움 체결 {f.fills}건 기준</div></div>
      <div className="stat"><div className="stat-label">거래 금액 대비</div><div className="stat-value">{amount > 0 ? `${((fee / amount) * 100).toFixed(2)}%` : "-"}</div><div className="stat-sub">사고판 금액 {won(amount)}원</div></div>
      <div className="stat"><div className="stat-label">한 번 사고팔 때 평균</div><div className="stat-value">{Number(f.fills) > 0 ? `${won(fee / Number(f.fills))}원` : "-"}</div><div className="stat-sub">{Number(f.us_fills) > 0 ? `미국 ${f.us_fills}건은 키움이 수수료를 안 알려 줘서 빠져 있어요` : "체결 한 묶음(하루·종목·방향)마다"}</div></div>
    </div>
  );
}

const starText = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

// 끝난 일기장의 사후강평. 기간은 전량 매도한 날 기준이에요.
async function reviewData(months: number | null, day: string): Promise<{ s: ReviewSummary; items: Reviewed[] }> {
  const [books, reviews] = await Promise.all([loadBooks(), loadReviews()]);
  const from = months === null ? "" : (() => { const d = new Date(`${day}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); })();
  const closed = books.filter((b) => b.end && b.end > from);
  const items = closed.flatMap((b): Reviewed[] => {
    const r = reviews.get(b.key);
    return r ? [{ key: b.key, name: b.name, end: b.end!, returnPct: b.returnPct, stars: r.stars, followed: r.followed_rules, lesson: r.lesson || r.exit_timing || r.thesis }] : [];
  });
  return { s: summarizeReviews(items, closed.length), items };
}

function StarBars({ rows }: { rows: ReviewSummary["byStars"] }) {
  const W = 520, H = 210, mid = 100, half = 72;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.avgReturn ?? 0)));
  const bw = W / rows.length;
  return (
    <svg className="month-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="별점별 평균 수익률">
      <line x1="0" x2={W} y1={mid} y2={mid} className="axis" />
      {rows.map((r, i) => {
        const v = r.avgReturn ?? 0;
        const h = Math.max(r.count ? 2 : 0, (Math.abs(v) / max) * half);
        const x = i * bw + bw * 0.3, y = v >= 0 ? mid - h : mid;
        return (
          <g key={r.stars}>
            <title>{`${r.stars}점 · ${r.count}권 · ${r.avgReturn === null ? "기록 없음" : sp(r.avgReturn)}`}</title>
            {r.count > 0 && r.avgReturn !== null && <rect x={x} y={y} width={bw * 0.4} height={h} rx="3" className={v >= 0 ? "up" : "down"} />}
            <text x={x + bw * 0.2} y={v >= 0 ? y - 6 : y + h + 14} textAnchor="middle" className="val">{r.count && r.avgReturn !== null ? sp(r.avgReturn) : ""}</text>
            <text x={x + bw * 0.2} y={H - 22} textAnchor="middle" className="star-lab">{"★".repeat(r.stars)}</text>
            <text x={x + bw * 0.2} y={H - 4} textAnchor="middle" className="lab">{r.count}권</text>
          </g>
        );
      })}
    </svg>
  );
}

function Reviews({ s, items, label }: { s: ReviewSummary; items: Reviewed[]; label: string }) {
  const list = lessons(items).slice(0, 8);
  return (
    <>
      <h2>사후강평 모아 보기 <span className="muted">{label} · 전량 매도한 날 기준</span></h2>
      {s.closed === 0 ? (
        <p className="muted">이 기간에 끝난 일기장이 없어요. 종목을 전부 팔면 일기장 마지막 장에 사후강평을 쓸 수 있어요.</p>
      ) : (
        <>
          <div className="stats four">
            <div className="stat"><div className="stat-label">강평 쓴 권</div><div className="stat-value">{s.reviewed} / {s.closed}권</div><div className="stat-sub">끝난 일기장 중</div></div>
            <div className="stat"><div className="stat-label">평균 별점</div><div className="stat-value">{s.avgStars ?? "-"}</div><div className="stat-sub star">{s.avgStars ? starText(Math.round(s.avgStars)) : "별점 없음"}</div></div>
            <div className="stat"><div className="stat-label">별점 4~5 평균</div><div className={`stat-value ${cls(s.high.avgReturn)}`}>{sp(s.high.avgReturn)}</div><div className="stat-sub">{s.high.count}권</div></div>
            <div className="stat"><div className="stat-label">별점 1~2 평균</div><div className={`stat-value ${cls(s.low.avgReturn)}`}>{sp(s.low.avgReturn)}</div><div className="stat-sub">{s.low.count}권</div></div>
          </div>
          <div className="stats-grid">
            <div className="panel">
              <div className="panel-title">별점별 평균 수익률</div>
              <StarBars rows={s.byStars} />
              <p className="muted small">별점을 높게 준 매매가 실제로도 더 벌었는지 보여 줘요.</p>
            </div>
            <div className="lessons">
              <div className="panel-title">내가 쓴 교훈 <span className="muted">최근 순</span></div>
              {list.length === 0 && <p className="muted">아직 쓴 교훈이 없어요. <Link href="/journal/books?s=unreviewed">강평 안 쓴 일기장 보기</Link></p>}
              {list.map((r) => (
                <Link key={r.key} href={`/journal/books?b=${encodeURIComponent(r.key)}`} className="lesson">
                  <span className="lesson-top">
                    {r.stars && <span className="star">{starText(r.stars)}</span>}
                    <b>{r.name}</b>
                    <span className={cls(r.returnPct)}>{sp(r.returnPct)}</span>
                    {r.followed !== null && <span className={r.followed ? "chip gold" : "chip"}>{r.followed ? "원칙 지킴" : "못 지킴"}</span>}
                    <span className="muted lesson-day">{r.end.slice(5)}</span>
                  </span>
                  <span className="lesson-text">{r.lesson}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const r = (await searchParams).r;
  const range = RANGES.find((x) => x.key === r) ?? RANGES[2];
  const rows = await query<Row>(
    `SELECT s.position_id, to_char(s.trade_date, 'YYYY-MM-DD') AS trade_date, p.ticker, p.name, s.return_pct, s.holding_days,
       s.reason_type, s.followed_rules, s.lesson
     FROM sell_entries s JOIN positions p ON p.id = s.position_id
     WHERE s.return_pct IS NOT NULL -- 평단을 모르는 매도는 승률·손익비에서 뺍니다
     ORDER BY s.trade_date DESC, s.id DESC`,
  );
  const all: (Sale & { positionId: number })[] = rows.map((x) => ({
    positionId: x.position_id, tradeDate: x.trade_date, ticker: x.ticker, name: x.name, returnPct: Number(x.return_pct),
    holdingDays: x.holding_days, reasonType: x.reason_type, followedRules: x.followed_rules, lesson: x.lesson,
  }));
  const day = today();
  const sales = since(all, day, range.months) as typeof all;
  const s = summarize(sales);
  const rules = byRules(sales);
  const broken = sales.filter((x) => !x.followedRules);
  const brokenLosses = broken.filter((x) => x.returnPct <= 0);
  const worstBroken = broken.length ? broken.reduce((a, b) => (b.returnPct < a.returnPct ? b : a)) : null;
  const months = monthly(all, day, range.months === null ? 12 : Math.max(6, range.months));
  const fees = await feeTotals(range.months);
  const reviewed = await reviewData(range.months, day);

  return (
    <>
      <div className="board-head">
        <h1>매매일지</h1>
        <JournalTabs on="stats" />
        <nav className="segment" aria-label="기간">
          {RANGES.map((x) => <Link key={x.key} href={`/journal/stats?r=${x.key}`} aria-current={x.key === range.key ? "page" : undefined}>{x.label}</Link>)}
        </nav>
      </div>

      <Fees f={fees} label={range.label} />

      {all.length === 0 ? (
        <p className="muted">아직 매도 기록이 없어요. 매매일지에서 매도를 기록하면 여기서 승률과 원칙을 지켰을 때의 성과를 계산해요.</p>
      ) : (
        <>
          <Tiles s={s} />
          <div className="stats-grid">
            <div className="panel">
              <div className="panel-title">월별 평균 실현 수익률 <span className="muted">매도한 달 기준</span></div>
              <MonthBars data={months} />
            </div>
            <div className="panel flush">
              <div className="panel-title">최근 청산 <span className="muted">{range.label}</span></div>
              {sales.length === 0 ? <div className="list-empty">이 기간에는 매도가 없어요.</div> : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>종목</th><th>매도일</th><th className="num">수익률</th><th className="num">보유</th><th>이유</th><th>원칙</th></tr></thead>
                    <tbody>
                      {sales.slice(0, 8).map((x, i) => (
                        <tr key={i}>
                          <td><Link className="stock-link" href={`/journal/${x.positionId}`}>{x.name}</Link></td>
                          <td className="num">{x.tradeDate.slice(5)}</td>
                          <td className={`num ${cls(x.returnPct)}`}>{sp(x.returnPct)}</td>
                          <td className="num">{x.holdingDays}일</td>
                          <td>{REASON[x.reasonType]}</td>
                          <td className={x.followedRules ? "gold" : "muted"}>{x.followedRules ? "지킴" : "안 지킴"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <h2>원칙을 지켰을 때 vs 안 지켰을 때 <span className="muted">매도할 때 체크한 &ldquo;원칙을 지켰나요?&rdquo; 기준</span></h2>
          <div className="rules-compare">
            <Side title="원칙 지킨 매매" s={rules.kept} on />
            <Side title="원칙 안 지킨 매매" s={rules.broken} />
          </div>
          {broken.length > 0 && worstBroken && (
            <div className="callout">
              원칙을 안 지킨 {broken.length}번 중 {brokenLosses.length}번이 손실이었어요.
              {worstBroken.returnPct < 0 && <> 가장 컸던 건 {worstBroken.name}({sp(worstBroken.returnPct)})예요.</>}
            </div>
          )}
          {broken.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>안 지킨 매매</th><th className="num">수익률</th><th>그때 남긴 교훈</th></tr></thead>
                <tbody>
                  {broken.slice(0, 10).map((x, i) => (
                    <tr key={i}>
                      <td><Link className="stock-link" href={`/journal/${x.positionId}`}>{x.name}</Link> <span className="muted code">{x.tradeDate}</span></td>
                      <td className={`num ${cls(x.returnPct)}`}>{sp(x.returnPct)}</td>
                      <td className="wrap">{x.lesson}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">매도 기록 한 건을 매매 한 번으로 세요. 수익률은 그 매도의 평단 대비 수익률이에요.</p>
        </>
      )}
      <Reviews s={reviewed.s} items={reviewed.items} label={range.label} />
    </>
  );
}
