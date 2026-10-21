import Link from "next/link";
import { query } from "@/lib/db";
import { askMistakes } from "@/app/actions";
import JournalTabs from "../JournalTabs";

export const dynamic = "force-dynamic";

type Example = { kind: "sell" | "book"; ref: string; name: string; ret: number | null };
type Mistake = { title: string; why: string; count: number; avg: number | null; examples: Example[] };
type Note = {
  at?: string; few?: number; mistakes?: Mistake[]; good?: string; summary?: string; next?: string;
  phrases?: { text: string; count: number }[]; sells?: number; reviews?: number;
};

const sp = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const cls = (v: number | null) => (v === null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const href = (e: Example) => (e.kind === "sell" ? `/journal/books/entry?sell=${e.ref}` : `/journal/books?b=${encodeURIComponent(e.ref)}`);
const when = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.month}.${p.day} ${p.hour}:${p.minute}`;
};

async function setting<T>(key: string): Promise<T | null> {
  const [row] = await query<{ value: T }>("SELECT value FROM app_settings WHERE key = $1", [key]).catch(() => []);
  return row?.value ?? null;
}

function Card({ m }: { m: Mistake }) {
  return (
    <div className="panel mistake">
      <div className="mistake-head"><b>{m.title}</b><span className="mistake-count">{m.count}번</span></div>
      {m.why && <p className="mistake-why">{m.why}</p>}
      <p className="mistake-ex">
        {m.examples.map((e, i) => (
          <span key={`${e.kind}${e.ref}`}>{i > 0 && " · "}<Link href={href(e)}>{e.name}</Link> <span className={cls(e.ret)}>{sp(e.ret)}</span></span>
        ))}
      </p>
      {m.avg !== null && <p className="mistake-why">이 실수가 있던 매매 평균 <span className={cls(m.avg)}>{sp(m.avg)}</span></p>}
    </div>
  );
}

export default async function MistakesPage() {
  const [note, asked, status] = await Promise.all([
    setting<Note>("mistakes"), setting<string>("mistakes_request"), setting<{ at: string; error: string | null }>("mistakes_status"),
  ]);
  const hasAi = Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const waiting = !!asked && (!note?.at || asked > note.at) && !(status?.error && status.at >= asked);
  // 10분이 넘도록 답이 없으면 워커가 꺼져 있는 거예요. 버튼을 다시 풀어 줘요.
  const stale = waiting && Date.now() - new Date(asked!).getTime() > 10 * 60_000;
  const reading = waiting && !stale;
  const list = note?.mistakes ?? [];

  return (
    <>
      <div className="board-head">
        <h1>매매일지</h1>
        <JournalTabs on="mistakes" />
        <form action={askMistakes} className="mistake-src">
          {note?.at && note.few === undefined && (
            <span className="muted">사후강평 {note.reviews}개 · 매도 일지 {note.sells}개 · 최근 6개월 · {when(note.at)} 읽음</span>
          )}
          <button type="submit" className="soft" disabled={reading || !hasAi} title={hasAi ? undefined : ".env에 GEMINI_API_KEY가 있어야 해요"}>
            {reading ? "읽는 중…" : "다시 읽기"}
          </button>
        </form>
      </div>

      {reading && <div className="callout ok">AI가 기록을 읽고 있어요. 1~2분 뒤 새로 고치면 보여요.</div>}
      {!hasAi && <div className="callout"><span>AI 키가 없어서 읽을 수 없어요. <code>notepad .env</code> 로 열어 <code>GEMINI_API_KEY=</code> 뒤에 키를 넣고 update.bat 을 다시 실행해 주세요.</span></div>}
      {stale && <div className="callout">10분이 지나도 답이 없어요. 워커가 꺼져 있을 수 있어요. 다시 읽기를 한 번 더 눌러 보세요.</div>}
      {status?.error && !waiting && <div className="callout">지난번에 못 읽었어요: {status.error}</div>}

      {!note ? (
        <div className="callout ok">아직 읽은 적이 없어요. 다시 읽기를 누르면 AI가 최근 6개월 매도 일지와 사후강평을 읽어요.</div>
      ) : note.few !== undefined ? (
        <div className="callout ok">최근 6개월 기록이 {note.few}개라 아직 읽기엔 적어요. 매도 일지나 사후강평이 3개 이상 쌓이면 읽어 드릴게요.</div>
      ) : (
        <>
          {list.length > 0 ? (
            <div className="mistakes">{list.map((m) => <Card key={m.title} m={m} />)}</div>
          ) : (
            <div className="callout ok">두 번 넘게 반복한 실수는 찾지 못했어요. 👍</div>
          )}
          <div className="mistake-bottom">
            {(note.summary || note.next) && (
              <div className="panel ai-sum">
                <div className="panel-title gold">AI 한 줄 정리</div>
                {note.summary && <p>{note.summary}</p>}
                {note.next && <p><span className="gold">다음 매수부터:</span> {note.next}</p>}
              </div>
            )}
            {(note.good || (note.phrases?.length ?? 0) > 0) && (
              <div className="panel">
                {note.good && <><div className="panel-title">잘한 점</div><p className="mistake-good">{note.good}</p></>}
                {(note.phrases?.length ?? 0) > 0 && (
                  <>
                    <div className="panel-title">자주 쓴 말</div>
                    <div className="phrases">{note.phrases!.map((p) => <span key={p.text} className="chip-btn">{p.text} {p.count}</span>)}</div>
                  </>
                )}
              </div>
            )}
          </div>
          <p className="muted">횟수와 평균 수익률은 AI가 아니라 기록에서 직접 셌어요. 한 주에 한 번 저절로 다시 읽어요.</p>
        </>
      )}
    </>
  );
}
