import Link from "next/link";
import { startStudy } from "@/app/actions";
import { query } from "@/lib/db";
import { loadBriefInput } from "@/lib/briefData";
import { valueCell } from "@/lib/brief";
import { cleanFields, filled, CHECKS, numbersOf, peerLine, verdictLabel, type Draft, type FinRow, type Pick, type Version } from "@/lib/study";
import WatchTabs from "../WatchTabs";
import StudyDice from "./StudyDice";
import StudyList, { type ListItem } from "./StudyList";
import StudyNote, { type NoteData } from "./StudyNote";

export const dynamic = "force-dynamic";

const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);

type NoteRow = {
  ticker: string; name: string; market: "KR" | "US"; status: string; confidence: number; fields: unknown; step: number; done: boolean;
  studied_on: string | null; review_on: string | null; source: string; pick: Pick | null; ai: Draft | null; ai_status: string | null; ai_error: string | null;
  updated: string;
};

export default async function StudyPage({ searchParams }: { searchParams: Promise<{ t?: string; step?: string; bad?: string }> }) {
  const sp = await searchParams;
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
      progress: r.done ? null : `${filled(f)}/${CHECKS.length}`, verdict: verdictLabel(f.verdict),
      due: Boolean(r.review_on && r.review_on <= today && r.status !== "탈락"),
    };
  });
  const names = await safe<{ ticker: string; name: string }>(
    `SELECT DISTINCT ON (ticker) ticker, name FROM (SELECT ticker, name, 1 AS k FROM watchlist UNION ALL SELECT ticker, name, 2 FROM holdings
       UNION ALL SELECT ticker, name, 3 FROM practice_pool) t WHERE name <> '' ORDER BY ticker, k`,
  );

  const picked = sp.t ? rows.find((r) => r.ticker === sp.t!.toUpperCase()) : undefined;
  let note: NoteData | null = null;
  if (picked) {
    const t = picked.ticker;
    const input = await loadBriefInput(t, picked.market);
    const peers = await safe<{ peer_ticker: string; peer_name: string }>("SELECT peer_ticker, peer_name FROM stock_peers WHERE ticker = $1 ORDER BY peer_name", [t]);
    const fin = await safe<FinRow>(
      "SELECT ticker, period, revenue, operating_income, liabilities, equity FROM stock_financials WHERE ticker = ANY($1)", [[t, ...peers.map((p) => p.peer_ticker)]],
    );
    const versions = (await safe<{ id: number; fields: unknown; confidence: number; price: string | null; saved_at: string }>(
      "SELECT id, fields, confidence, price, saved_at::text FROM study_versions WHERE ticker = $1 ORDER BY saved_at", [t],
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
    note = {
      ticker: t, name: picked.name, market: picked.market, status: picked.status, confidence: picked.confidence, fields: cleanFields(picked.fields, true),
      step: Math.max(0, Math.min(5, Number(sp.step ?? picked.step) || 0)), done: picked.done, studiedOn: picked.studied_on, reviewOn: picked.review_on,
      source: picked.source, pick: picked.pick, ai: picked.ai, aiStatus: picked.ai_status, aiError: picked.ai_error,
      price: input.price, numbers,
      peers: [mine, ...peers.map((p) => peerLine(p.peer_ticker, p.peer_name, fin))],
      versions, events, filings, value: value.signal === "n" ? null : value.text, alerts: alerts.map((a) => Number(a.price)), today,
    };
  }

  return (
    <>
      <div className="board-head">
        <h1>관심종목</h1>
        <WatchTabs on="study" />
      </div>
      <div className={`study-layout${note ? " has-note" : ""}`}>
        <aside className="study-aside">
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
          {note ? (
            <>
              <Link href="/watch/study" className="study-back">‹ 노트 목록</Link>
              <StudyNote key={`${note.ticker}:${note.done}`} note={note} />
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
