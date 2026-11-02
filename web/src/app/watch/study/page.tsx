import Link from "next/link";
import { settleStudyFill, startStudy } from "@/app/actions";
import { query } from "@/lib/db";
import { loadBriefInput } from "@/lib/briefData";
import { valueCell } from "@/lib/brief";
import { cheapGap, cleanFields, filled, CHECKS, groupBySector, numbersOf, peerLine, STYLES, verdictLabel, type Draft, type FinRow, type Pick, type Version } from "@/lib/study";
import WatchTabs from "../WatchTabs";
import StudyDice from "./StudyDice";
import StudyGroups, { StudyCompare, type Group, type GroupItem } from "./StudyGroups";
import StudyList, { type ListItem } from "./StudyList";
import StudyNote, { type NoteData } from "./StudyNote";
import ThesisBoard, { type ThesisData } from "./ThesisBoard";
import DeepView from "./DeepView";
import { earningsHistory, quartersFrom, reviewRows, seeds, upcoming, type Close, type Estimate, type Evidence, type Filing, type Review, type Status, type Suggestion, type Thesis } from "@/lib/thesis";
import type { Report } from "@/lib/earnings";
import type { BriefInput } from "@/lib/brief";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);

type NoteRow = {
  ticker: string; name: string; market: "KR" | "US"; status: string; confidence: number; fields: unknown; step: number; done: boolean;
  studied_on: string | null; review_on: string | null; source: string; pick: Pick | null; ai: Draft | null; ai_status: string | null; ai_error: string | null;
  updated: string;
};

export default async function StudyPage({ searchParams }: { searchParams: Promise<{ t?: string; step?: string; bad?: string; view?: string; sector?: string; style?: string; tab?: string }> }) {
  const sp = await searchParams;
  // 🤖 전부 채우기 초안이 기다리는 동안 도착했으면 지금 채워요.
  if (sp.t) await settleStudyFill(sp.t).catch(() => false);
  const rows = await safe<NoteRow>(
    `SELECT ticker, name, market, status, confidence, fields, step, done, to_char(studied_on, 'YYYY-MM-DD') AS studied_on,
       to_char(review_on, 'YYYY-MM-DD') AS review_on, source, pick, ai, ai_status, ai_error, to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'MM.DD') AS updated
     FROM study_notes ORDER BY updated_at DESC`,
  );
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const list: ListItem[] = rows.map((r) => {
    const f = cleanFields(r.fields);
    return {
      ticker: r.ticker, name: r.name, status: r.status, updated: r.updated, done: r.done, ai: r.source === "ai",
      progress: r.done ? null : `${filled(f)}/${CHECKS.length}`, verdict: verdictLabel(f.verdict), kind: [f.sector, ...f.styles].filter(Boolean).join(" · "),
      due: Boolean(r.review_on && r.review_on <= today && r.status !== "탈락"),
    };
  });
  const names = await safe<{ ticker: string; name: string }>(
    `SELECT DISTINCT ON (ticker) ticker, name FROM (SELECT ticker, name, 1 AS k FROM watchlist UNION ALL SELECT ticker, name, 2 FROM holdings
       UNION ALL SELECT ticker, name, 3 FROM practice_pool) t WHERE name <> '' ORDER BY ticker, k`,
  );

  // 모아 보기(업종별 묶음 → 업종 이름을 누르면 같은 업종 비교)
  const grouped = sp.view === "group" && !sp.t;
  const style = sp.style && (STYLES as readonly string[]).includes(sp.style) ? sp.style : null;
  let groups: Group[] = [];
  let compare: { group: Group; cached: string | null } | null = null;
  if (grouped) {
    const tickers = rows.map((r) => r.ticker);
    const known = new Map((await safe<{ ticker: string; sector: string }>("SELECT ticker, sector FROM stock_sectors WHERE ticker = ANY($1) AND sector <> ''", [tickers])).map((r) => [r.ticker, r.sector]));
    const prices = new Map((await safe<{ ticker: string; cur: string | null }>(
      `SELECT t AS ticker, COALESCE((SELECT cur_price FROM held_all WHERE ticker = t AND cur_price > 0 LIMIT 1), (SELECT price FROM watch_quotes WHERE ticker = t),
         (SELECT close FROM price_history WHERE ticker = t ORDER BY day DESC LIMIT 1)) AS cur FROM unnest($1::text[]) t`, [tickers],
    )).map((r) => [r.ticker, r.cur === null ? null : Number(r.cur)]));
    const fin = sp.sector ? await safe<FinRow>("SELECT ticker, period, revenue, operating_income, liabilities, equity FROM stock_financials WHERE ticker = ANY($1)", [tickers]) : [];
    const items: GroupItem[] = rows.map((r) => {
      const f = cleanFields(r.fields);
      return {
        ticker: r.ticker, name: r.name, sector: f.sector || known.get(r.ticker) || "", known: !f.sector && known.has(r.ticker), styles: f.styles,
        verdict: verdictLabel(f.verdict), verdictKey: f.verdict, status: r.status, done: r.done, gap: cheapGap(f.cheap, prices.get(r.ticker) ?? null),
        ai: r.source === "ai", confidence: r.confidence, peer: peerLine(r.ticker, r.name, fin),
      };
    }).filter((it) => !style || it.styles.includes(style));
    groups = groupBySector(items);
    const g = sp.sector ? groups.find((x) => x.sector === sp.sector) : undefined;
    if (g) {
      const [c] = await safe<{ value: { sector?: string; tickers?: string[]; status?: string; text?: string } | null }>("SELECT value FROM app_settings WHERE key = 'study_compare'");
      const v = c?.value;
      const same = v?.status === "done" && v.sector === g.sector && [...(v.tickers ?? [])].sort().join() === g.items.map((i) => i.ticker).sort().join();
      compare = { group: g, cached: same ? v?.text ?? null : null };
    }
  }

  const picked = sp.t ? rows.find((r) => r.ticker === sp.t!.toUpperCase()) : undefined;
  let note: NoteData | null = null;
  const tab = sp.tab === "thesis" || sp.tab === "deep" ? sp.tab : "note";
  let thesisData: ThesisData | null = null;
  let deep: { input: BriefInput; note: string } | null = null;
  let openCount = 0;
  if (picked) {
    const t = picked.ticker;
    const input = await loadBriefInput(t, picked.market);
    const peers = await safe<{ peer_ticker: string; peer_name: string }>("SELECT peer_ticker, peer_name FROM stock_peers WHERE ticker = $1 ORDER BY peer_name", [t]);
    const fin = await safe<FinRow>(
      "SELECT ticker, period, revenue, operating_income, liabilities, equity FROM stock_financials WHERE ticker = ANY($1)", [[t, ...peers.map((p) => p.peer_ticker)]],
    );
    const versions = (await safe<{ id: number; fields: unknown; confidence: number; price: string | null; saved_at: string }>(
      // ISO 8601(+09:00)로 받아요. saved_at::text("… +09")는 Safari의 new Date가 못 읽어요.
      `SELECT id, fields, confidence, price, to_char(saved_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS saved_at FROM study_versions WHERE ticker = $1 ORDER BY saved_at`, [t],
    )).map<Version>((v) => ({ id: v.id, fields: cleanFields(v.fields), confidence: v.confidence, price: v.price === null ? null : Number(v.price), saved_at: v.saved_at }));
    const events = await safe<{ day: string; title: string }>(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, title FROM calendar_events WHERE ticker = $1 AND day >= CURRENT_DATE ORDER BY day LIMIT 4", [t],
    );
    const filings = await safe<{ day: string; title: string }>(
      "SELECT to_char(day, 'MM.DD') AS day, title FROM stock_disclosures WHERE ticker = $1 ORDER BY day DESC LIMIT 4", [t],
    );
    const alerts = await safe<{ price: string }>(
      "SELECT price FROM alerts WHERE ticker = $1 AND kind = 'custom' AND direction = 'below' AND active AND triggered_at IS NULL", [t],
    );
    const [sector] = await safe<{ sector: string }>("SELECT sector FROM stock_sectors WHERE ticker = $1 AND sector <> ''", [t]);
    const value = valueCell(input);
    // 내 회사 줄은 ③과 같은 재무제표 숫자로 맞춰요(재무 요약과 기준이 조금 달라서).
    const numbers = numbersOf(input.statements);
    const mine = peerLine(t, picked.name, fin);
    if (numbers) {
      const [prev, last] = numbers.revenue.slice(-2);
      mine.margin = numbers.margin;
      mine.debt = numbers.debt;
      mine.growth = prev && last !== undefined && last !== null ? Math.round((last / prev - 1) * 1000) / 10 : mine.growth;
      mine.ready = true;
    }
    const [oc] = await safe<{ n: number }>("SELECT count(*)::int AS n FROM study_theses WHERE ticker = $1 AND status IN ('watch', 'ok', 'bad')", [t]);
    openCount = oc?.n ?? 0;
    if (tab === "thesis") thesisData = await loadThesis(t, picked.name, picked.market, cleanFields(picked.fields), input, today);
    if (tab === "deep") {
      const [dn] = await safe<{ deep_note: string }>("SELECT deep_note FROM study_notes WHERE ticker = $1", [t]);
      deep = { input, note: dn?.deep_note ?? "" };
    }
    note = {
      ticker: t, name: picked.name, market: picked.market, status: picked.status, confidence: picked.confidence, fields: cleanFields(picked.fields, true),
      step: Math.max(0, Math.min(5, Number(sp.step ?? picked.step) || 0)), done: picked.done, studiedOn: picked.studied_on, reviewOn: picked.review_on,
      source: picked.source, pick: picked.pick, ai: picked.ai, aiStatus: picked.ai_status, aiError: picked.ai_error,
      price: input.price, numbers, knownSector: sector?.sector ?? null,
      peers: [mine, ...peers.map((p) => peerLine(p.peer_ticker, p.peer_name, fin))],
      versions, events, filings, value: value.signal === "n" ? null : value.text, alerts: alerts.map((a) => Number(a.price)), today,
      aiKey: Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY),
    };
  }

  return (
    <>
      <div className="board-head">
        <h1>관심종목</h1>
        <WatchTabs on="study" />
      </div>
      <div className={`study-layout${note ? " has-note" : ""}${grouped ? " grouped" : ""}`}>
        <aside className="study-aside">
          <nav className="segment study-view" aria-label="보기">
            <Link href="/watch/study" aria-current={grouped ? undefined : "page"}>목록</Link>
            <Link href="/watch/study?view=group" aria-current={grouped ? "page" : undefined}>업종별 모아 보기</Link>
          </nav>
          <StudyList items={list} on={picked?.ticker ?? null} />
          <form action={startStudy} className="panel study-new">
            <b>＋ 새 노트</b>
            <input name="ticker" list="study-names" placeholder="종목코드·티커 (005930, AAPL)" required />
            <datalist id="study-names">{names.map((n) => <option key={n.ticker} value={n.ticker}>{n.name}</option>)}</datalist>
            <input name="name" placeholder="이름 (모르면 비워 두세요)" />
            <button type="submit">공부 시작</button>
            {sp.bad && <p className="practice-warn">종목코드를 다시 확인해 주세요.</p>}
          </form>
          <StudyDice />
        </aside>
        <section className="study-main">
          {grouped ? (
            compare ? <StudyCompare group={compare.group} all={groups} style={style} cached={compare.cached} /> : <StudyGroups groups={groups} style={style} />
          ) : note ? (
            <>
              <Link href="/watch/study" className="study-back">‹ 노트 목록</Link>
              <nav className="tabs2" aria-label="노트 보기">
                {([["note", "노트"], ["thesis", "가설"], ["deep", "깊이 보기"]] as const).map(([k, label]) => (
                  <Link key={k} href={`/watch/study?t=${encodeURIComponent(note!.ticker)}${k === "note" ? "" : `&tab=${k}`}`} aria-current={tab === k ? "page" : undefined}>
                    {label}{k === "thesis" && openCount > 0 && <em>{openCount}</em>}
                  </Link>
                ))}
              </nav>
              {tab === "note" ? <StudyNote key={`${note.ticker}:${note.done}`} note={note} /> : (
                <>
                  <div className="study-title th-title">
                    <h2>{note.name}</h2>
                    <span className="muted">{note.ticker}{note.price !== null && ` · ${note.market === "US" ? `$${note.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${Math.round(note.price).toLocaleString("ko-KR")}원`}`}</span>
                    <span className={`study-tag s-${note.status}`}>{note.status}</span>
                  </div>
                  {tab === "thesis" && thesisData && <ThesisBoard data={thesisData} />}
                  {tab === "deep" && deep && <DeepView ticker={note.ticker} input={deep.input} note={deep.note} />}
                </>
              )}
            </>
          ) : (
            <div className="panel study-intro">
              <h2>회사 한 곳을 한 장으로 정리해요</h2>
              <p className="muted">
                처음엔 6단계 질문을 따라 적고, 다 적으면 한 장 노트가 돼요. 숫자와 경쟁사 비교는 앱이 채우고,
                나머지는 내 생각을 적어요. 다시 볼 날이 되면 텔레그램으로 알려 드려요.
              </p>
              <ol className="study-steps-intro">
                <li><b>한 줄로 말하면 · 돈 버는 구조</b> 무엇을 누구에게 팔아 돈을 버나</li>
                <li><b>경영진이 한 말 · 앞으로 일</b> 약속을 지키는 회사인가, 무엇이 주가를 움직이나</li>
                <li><b>숫자가 뒷받침하나</b> 이익과 현금이 같이 느나 (앱이 채움)</li>
                <li><b>경쟁사와 비교</b> 이 회사만의 강점은 (표는 앱이 채움)</li>
                <li><b>틀릴 수 있는 이유 3개</b> 이게 보이면 다시 생각한다는 신호까지</li>
                <li><b>가격 생각 · 결론</b> 싸다·비싸다 가격, 산다·기다린다·안 산다</li>
              </ol>
              <p className="muted practice-small">🎲 AI 추천을 누르면 요즘 흐름이 좋은 큰 종목 중 하나를 AI가 골라, 왜 골랐는지와 참고용 초안을 붙여 노트를 만들어 줘요.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// 가설 탭 자료: 가설·근거, 아직 안 끝낸 실적 날 점검, 다가오는 확인 날, 지난 실적 발표 기록
async function loadThesis(ticker: string, name: string, market: "KR" | "US", fields: ReturnType<typeof cleanFields>, input: BriefInput, today: string): Promise<ThesisData> {
  const rows = await safe<{
    id: number; title: string; rule: string; due_on: string | null; metric: Thesis["metric"]; op: Thesis["op"]; target: string | null; status: Status;
    source: string; ai: Suggestion | null; created_at: string; decided_at: string | null; scanned: boolean;
  }>(
    `SELECT id, title, rule, to_char(due_on, 'YYYY-MM-DD') AS due_on, metric, op, target, status, source, ai,
       to_char(created_at, 'YYYY-MM-DD') AS created_at, to_char(decided_at, 'YYYY-MM-DD') AS decided_at, scanned_at IS NOT NULL AS scanned
     FROM study_theses WHERE ticker = $1 ORDER BY id`, [ticker],
  );
  const ev = await safe<Evidence & { thesis_id: number; value: string | null }>(
    `SELECT e.id, e.thesis_id, to_char(e.day, 'YYYY-MM-DD') AS day, e.kind, e.ref, e.text, e.url, e.sign, e.value
     FROM study_evidence e JOIN study_theses t ON t.id = e.thesis_id WHERE t.ticker = $1`, [ticker],
  );
  const theses: Thesis[] = rows.map((r) => ({
    id: r.id, title: r.title, rule: r.rule, dueOn: r.due_on, metric: r.metric, op: r.op, target: r.target === null ? null : Number(r.target),
    status: r.status, source: r.source, ai: r.ai, createdAt: r.created_at, decidedAt: r.decided_at, scanned: r.scanned,
    evidence: ev.filter((e) => e.thesis_id === r.id).map((e) => ({ ...e, value: e.value === null ? null : Number(e.value) })),
  }));
  const reviews = (await safe<{ id: string; period: string; day: string; memo: string; done_at: string | null; items: Review["items"] }>(
    "SELECT id, period, to_char(day, 'YYYY-MM-DD') AS day, memo, to_char(done_at, 'YYYY-MM-DD') AS done_at, items FROM study_reviews WHERE ticker = $1 ORDER BY period DESC", [ticker],
  )).map<Review>((r) => ({ id: r.id, period: r.period, day: r.day, memo: r.memo, doneAt: r.done_at, items: r.items ?? [] }));
  const pending = reviews.find((r) => !r.doneAt) ?? null;
  const filings = await safe<Filing>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, period, title, url, source FROM earnings_filings WHERE ticker = $1 ORDER BY day", [ticker],
  );
  const reports = await safe<Report>(
    "SELECT period, to_char(reported_on, 'YYYY-MM-DD') AS reported_on, url, market, data, ai FROM earnings_reports WHERE ticker = $1 ORDER BY reported_on", [ticker],
  );
  const events = await safe<{ day: string; title: string; kind: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, title, kind FROM calendar_events WHERE ticker = $1 AND day >= CURRENT_DATE ORDER BY day LIMIT 6", [ticker],
  );
  const num = (v: string | null) => (v === null ? null : Number(v));
  const estimates = (await safe<{ period: string; source: Estimate["source"]; eps_actual: string | null; eps_estimate: string | null; revenue_actual: string | null;
    revenue_estimate: string | null; op_estimate: string | null; net_estimate: string | null; reported_on: string | null; hour: string | null; as_of: string }>(
    `SELECT period, source, eps_actual, eps_estimate, revenue_actual, revenue_estimate, op_estimate, net_estimate,
       to_char(reported_on, 'YYYY-MM-DD') AS reported_on, hour, to_char(as_of, 'YYYY-MM-DD') AS as_of FROM earnings_estimates WHERE ticker = $1`, [ticker],
  )).map<Estimate>((r) => ({
    period: r.period, source: r.source, epsActual: num(r.eps_actual), epsEstimate: num(r.eps_estimate), revenueActual: num(r.revenue_actual),
    revenueEstimate: num(r.revenue_estimate), opEstimate: num(r.op_estimate), netEstimate: num(r.net_estimate), reportedOn: r.reported_on, hour: r.hour, asOf: r.as_of,
  }));
  const closes = (await safe<{ day: string; close: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, close FROM price_history WHERE ticker = $1 AND day >= CURRENT_DATE - 1200 ORDER BY day", [ticker],
  )).map<Close>((r) => ({ day: r.day, close: Number(r.close) }));
  return {
    ticker, name, market, theses, seeds: seeds(fields, theses.map((x) => x.title)),
    review: pending ? { ...pending, rows: reviewRows(pending.period, theses) } : null,
    history: earningsHistory(filings, reports, quartersFrom(input.statements), reviews, 12, { estimates, closes }),
    upcoming: upcoming(theses, events, today),
    aiKey: Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY), today,
  };
}
