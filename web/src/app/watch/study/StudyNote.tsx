"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { addStudyPeer, deleteStudy, readStudyDraft, removeStudyPeer, requestStudyDraft, saveStudy, setStudyMeta, studyAlert } from "@/app/actions";
import { usd, won } from "@/lib/format";
import { money } from "@/lib/statements";
import {
  applyDraft, bars, CHECKS, draftPromises, filled, pastLabel, pastSelf, RESULTS, splitOf, STATUSES, STEPS, STYLES, VERDICTS, verdictLabel,
  type Draft, type Fields, type Numbers, type PeerLine, type Pick, type Version,
} from "@/lib/study";

export type NoteData = {
  ticker: string; name: string; market: "KR" | "US"; status: string; confidence: number; fields: Fields; step: number; done: boolean;
  studiedOn: string | null; reviewOn: string | null; source: string; pick: Pick | null; ai: Draft | null; aiStatus: string | null; aiError: string | null;
  price: number | null; numbers: Numbers | null; knownSector: string | null; peers: PeerLine[]; versions: Version[]; events: { day: string; title: string }[];
  filings: { day: string; title: string }[]; value: string | null; alerts: number[]; today: string;
};

type Set = (f: Fields) => void;
const AI_PARTS = [["kind", "one", "model"], ["promises", "events"], ["numbers"], ["moat"], ["risks"], ["price", "conclusion", "sources"]];
const dot = (d: string) => d.replaceAll("-", ".");
const pct = (v: number | null, sign = false) => (v === null ? "-" : `${sign && v > 0 ? "+" : ""}${v}%`);

export default function StudyNote({ note }: { note: NoteData }) {
  const router = useRouter();
  const [fields, setFields] = useState(note.fields);
  const [step, setStep] = useState(note.step);
  const [status, setStatus] = useState(note.status);
  const [confidence, setConfidence] = useState(note.confidence);
  const [reviewOn, setReviewOn] = useState(note.reviewOn ?? "");
  const [ai, setAi] = useState({ draft: note.ai, status: note.aiStatus, error: note.aiError, fill: false });
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "fail">("");
  const money_ = (v: number) => (note.market === "US" ? usd(v) : `${won(v)}원`);

  // AI 초안을 부탁해 두었으면 3초마다 확인해요.
  useEffect(() => {
    if (ai.status !== "pending") return;
    const timer = setTimeout(async () => {
      const r = await readStudyDraft(note.ticker).catch(() => null);
      if (r?.filled) router.refresh();
      else if (r) setAi((a) => ({ ...a, draft: (r.ai as Draft) ?? null, status: r.status, error: r.error }));
    }, 3000);
    return () => clearTimeout(timer);
  }, [ai, note.ticker, router]);

  async function askAi(fill = false) {
    // 전부 채우기는 지금 적은 칸을 먼저 저장해 두고, 초안은 빈 칸에만 들어가요.
    if (fill) await save(fields);
    await requestStudyDraft(note.ticker, fill);
    setAi((a) => ({ ...a, status: "pending", error: null, fill }));
  }
  async function save(next: Fields, extra: { step?: number; finish?: boolean } = {}) {
    setSaving("saving");
    const ok = await saveStudy({ ticker: note.ticker, fields: next, ...extra }).catch(() => false);
    setSaving(ok ? "saved" : "fail");
    return ok;
  }
  function meta(m: { status?: string; confidence?: number; reviewOn?: string | null }) {
    if (m.status) setStatus(m.status);
    if (m.confidence !== undefined) setConfidence(m.confidence);
    if (m.reviewOn !== undefined) setReviewOn(m.reviewOn ?? "");
    setStudyMeta({ ticker: note.ticker, ...m }).catch(() => setSaving("fail"));
  }

  const count = filled(fields);
  return (
    <div className="study-note">
      <div className="study-head">
        <div className="study-title">
          <h2>{note.name}</h2>
          <span className="muted">{note.ticker}{note.price !== null && ` · ${money_(note.price)}`}</span>
          <Link href={`/stock/${encodeURIComponent(note.ticker)}`} className="chip-btn">종목 화면</Link>
        </div>
        <div className="segment study-seg" role="radiogroup" aria-label="상태">
          {STATUSES.map((s) => <button key={s} type="button" aria-selected={status === s} onClick={() => meta({ status: s })}>{s}</button>)}
        </div>
      </div>
      <div className="study-meta muted">
        <span className="study-conf" aria-label="확신도">확신도
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={n <= confidence ? "on" : ""} aria-label={`확신도 ${n}`} onClick={() => meta({ confidence: n === confidence ? n - 1 : n })} />
          ))}
        </span>
        {note.studiedOn && <span>공부한 날 {dot(note.studiedOn)}</span>}
        <label className="study-review">🔔 다시 볼 날
          <input type="date" value={reviewOn} onChange={(e) => meta({ reviewOn: e.target.value || null })} />
        </label>
        {note.versions.length > 0 && <span>버전 {note.versions.length}</span>}
        <span className="study-saving">{saving === "saving" ? "저장 중…" : saving === "saved" ? "저장했어요" : saving === "fail" ? "저장 못 했어요" : ""}</span>
      </div>

      <KindRow f={fields} known={note.knownSector} draft={ai.draft} onSave={async (next) => { setFields(next); await save(next); }} />
      {note.pick && <PickCard pick={note.pick} />}
      <AiBar status={ai.status} error={ai.error} has={Boolean(ai.draft)} fill={ai.fill} searched={ai.draft?.searched} news={ai.draft?.news} searchError={ai.draft?.searchError} onAsk={askAi} />

      {note.done ? (
        <OnePage note={note} fields={fields} setFields={setFields} save={save} draft={ai.draft} money_={money_} />
      ) : (
        <Wizard note={note} fields={fields} setFields={setFields} step={step} count={count} draft={ai.draft} money_={money_}
          go={async (n) => { await save(fields, { step: n }); setStep(n); window.scrollTo({ top: 0 }); }}
          finish={async () => { if (await save(fields, { finish: true })) router.refresh(); }} />
      )}
    </div>
  );
}

function PickCard({ pick }: { pick: Pick }) {
  return (
    <div className="panel study-pick">
      <div className="study-pick-head"><b>🎲 AI가 이 회사를 고른 이유</b>{pick.fresh && <span className="study-tag">🧭 안 해 본 쪽에서</span>}<span className="muted practice-small">{pick.flow}</span></div>
      {pick.why.length > 0 && <ul>{pick.why.map((w) => <li key={w}>{w}</li>)}</ul>}
      {pick.first.length > 0 && (
        <>
          <div className="study-lab">먼저 확인해 볼 질문</div>
          <ol>{pick.first.map((w) => <li key={w}>{w}</li>)}</ol>
        </>
      )}
      <p className="muted practice-small">흐름이 좋다는 건 주가가 최근 올랐다는 뜻일 뿐이에요. 사라는 뜻이 아니고, 공부해 볼 거리예요.</p>
    </div>
  );
}

// 무료 Gemini 키는 웹 검색이 없어서, 대신 구글 뉴스에서 모은 최근 기사 제목을 읽고 써요.
function searchNote(news?: number, searchError?: string): string {
  const read = news ? `최근 한 달 기사 ${news}건을 읽고 썼어요` : "웹 검색 없이 썼어요";
  if (searchError) return `웹 검색이 안 돼서 ${read}. 검색 오류: ${searchError}`;
  return news ? `무료 AI 키라 웹 검색 대신 ${read}` : `이번엔 ${read}`;
}

function AiBar({ status, error, has, fill, searched, news, searchError, onAsk }: {
  status: string | null; error: string | null; has: boolean; fill: boolean; searched?: boolean; news?: number; searchError?: string; onAsk: (fill?: boolean) => void;
}) {
  if (status === "none") return null;
  return (
    <div className="study-aibar">
      {status === "pending" ? (
        <span className="muted">{error ? `⏳ ${error}` : fill ? "🤖 AI가 검색해서 노트 전체를 채우는 중이에요… 길면 5분쯤 걸려요. 다른 화면에 가도 돼요." : "✨ AI가 검색해 보고 초안을 쓰는 중이에요…"}</span>
      ) : (
        <>
          <button type="button" onClick={() => onAsk(true)}>🤖 AI가 전부 채우기</button>
          <button type="button" className="chip-btn" onClick={() => onAsk(false)}>{has ? "✨ 초안 다시 받기" : "✨ 칸마다 초안만 보기"}</button>
        </>
      )}
      {status === "error" && <span className="practice-warn practice-small">초안을 못 받았어요{error ? `: ${error}` : ""}</span>}
      {status !== "pending" && (
        <span className="muted practice-small">
          {has ? `초안은 칸마다 ✨로 보여요${searched === false ? ` (${searchNote(news, searchError)})` : ""}. ` : ""}
          전부 채우기는 빈 칸에만 넣고, 판단(산다·기다린다·안 산다)은 직접 골라요. AI 글은 틀릴 수 있어요.
        </span>
      )}
    </div>
  );
}

// 업종 · 주식 유형: 노트 맨 위 한 줄. 업종은 비어 있으면 증권사 분류를 보여 줘요.
function KindRow({ f, known, draft, onSave }: { f: Fields; known: string | null; draft: Draft | null; onSave: (f: Fields) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  const [work, setWork] = useState(f);
  const sector = f.sector || known || "";
  if (edit) {
    const toggle = (x: string) => setWork({ ...work, styles: work.styles.includes(x) ? work.styles.filter((y) => y !== x) : [...work.styles, x].slice(-3) });
    return (
      <div className="panel study-kind editing">
        <label className="study-lab">업종<input value={work.sector} onChange={(e) => setWork({ ...work, sector: e.target.value })} placeholder={known ?? "예: 반도체, 2차전지, 인터넷"} /></label>
        <div className="study-lab">주식 유형 <span className="muted">3개까지</span></div>
        <div className="study-styles">
          {STYLES.map((x) => <button key={x} type="button" className={`chip-btn${work.styles.includes(x) ? " on" : ""}`} aria-pressed={work.styles.includes(x)} onClick={() => toggle(x)}>{x}</button>)}
        </div>
        {draft && (draft.sector || draft.styles?.length) ? (
          <p className="muted practice-small">✨ AI 생각: {[draft.sector, ...(draft.styles ?? [])].filter(Boolean).join(" · ")}
            {" "}<button type="button" className="chip-btn" onClick={() => setWork(applyDraft(work, draft, ["kind"]))}>빈 칸에 넣기</button></p>
        ) : null}
        <div className="study-edit-acts">
          <button type="button" onClick={async () => { await onSave(work); setEdit(false); }}>저장</button>
          <button type="button" className="soft" onClick={() => setEdit(false)}>취소</button>
        </div>
      </div>
    );
  }
  return (
    <div className="study-kind">
      <span className="study-lab">업종</span> {sector ? <b>{sector}</b> : <span className="muted">-</span>}
      {!f.sector && known && <span className="muted practice-small"> (증권사 분류)</span>}
      <span className="study-lab">유형</span> {f.styles.length ? f.styles.map((x) => <span key={x} className="study-tag">{x}</span>) : <span className="muted">-</span>}
      <button type="button" className="chip-btn" onClick={() => { setWork(f); setEdit(true); }}>✎ 고치기</button>
    </div>
  );
}

// ---------------------------------------------------------------- B: 처음 적기
function Wizard({ note, fields, setFields, step, count, draft, money_, go, finish }: {
  note: NoteData; fields: Fields; setFields: Set; step: number; count: number; draft: Draft | null; money_: (v: number) => string;
  go: (n: number) => void; finish: () => void;
}) {
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="study-wizard">
      <div className="study-steps" aria-label={`${step + 1}/${STEPS.length}단계`}>
        {STEPS.map((x, i) => <button key={x.title} type="button" className={i < step ? "done" : i === step ? "now" : ""} onClick={() => go(i)} aria-label={x.title} />)}
      </div>
      <div className="study-wiz-grid">
        <div className="study-wiz-main">
          <div className="muted practice-small">{step + 1} / {STEPS.length}단계 · {s.title} · 노트 {count}/{CHECKS.length}칸 채움</div>
          <h3 className="study-q">{s.q}</h3>
          <p className="muted study-hint">{s.hint}</p>
          {draft && AI_PARTS[step].length > 0 && <DraftBox draft={draft} parts={AI_PARTS[step]} onUse={() => setFields(applyDraft(fields, draft, AI_PARTS[step]))} />}
          {step === 5 && draft?.questions && draft.questions.length > 0 && (
            <div className="study-draft"><b>✨ 스스로 답해 볼 질문 (참고용)</b><ul>{draft.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>
          )}
          <Parts step={step} note={note} f={fields} set={setFields} draft={draft} money_={money_} />
          <div className="study-nav">
            {step > 0 && <button type="button" className="soft" onClick={() => go(step - 1)}>‹ 이전</button>}
            <span className="spacer" />
            {!last && <button type="button" className="ghost" onClick={() => go(step + 1)}>건너뛰기</button>}
            {last ? <button type="button" onClick={finish}>다 적었어요 ✓</button> : <button type="button" onClick={() => go(step + 1)}>다음: {STEPS[step + 1].title} ›</button>}
          </div>
          {last && <p className="muted practice-small">다 적으면 한 장 노트로 바뀌고, 그때 생각을 버전으로 남겨요. 다시 볼 날을 안 정했으면 석 달 뒤로 잡아요.</p>}
        </div>
        <ol className="study-step-list">
          {STEPS.map((x, i) => (
            <li key={x.title}><button type="button" className={i === step ? "now" : ""} onClick={() => go(i)}>{i < step ? "✓" : i === step ? "●" : "○"} {x.title}</button></li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Parts({ step, note, f, set, money_ }: { step: number; note: NoteData; f: Fields; set: Set; draft: Draft | null; money_: (v: number) => string }) {
  switch (step) {
    case 0: return <><Sec n="①" title="한 줄로 말하면"><OneEd f={f} set={set} /></Sec><Sec n="②" title="돈 버는 구조"><ModelEd f={f} set={set} /></Sec></>;
    case 1: return <><Sec n="⑤" title="경영진이 한 말 · 지켰나"><PromisesEd f={f} set={set} filings={note.filings} /></Sec><Sec n="⑥" title="앞으로 일어날 일"><EventsEd f={f} set={set} app={note.events} /></Sec></>;
    case 2: return <Sec n="③" title="숫자가 뒷받침하나" auto><NumbersView n={note.numbers} market={note.market} /><NumbersEd f={f} set={set} /></Sec>;
    case 3: return <Sec n="④" title="경쟁사와 비교" auto><PeersView note={note} edit /><MoatEd f={f} set={set} /></Sec>;
    case 4: return <Sec n="⑦" title="내가 틀릴 수 있는 이유 3개"><RisksEd f={f} set={set} /></Sec>;
    default: return (
      <>
        <Sec n="⑧" title="내 가격 생각"><PriceEd f={f} set={set} note={note} money_={money_} /></Sec>
        <Sec n="⑨" title="결론 (5줄 안에)"><ConclusionEd f={f} set={set} /></Sec>
        <Sec n="⑩" title="자료·출처"><SourcesEd f={f} set={set} /></Sec>
      </>
    );
  }
}

function DraftBox({ draft, parts, onUse }: { draft: Draft; parts: string[]; onUse: () => void }) {
  const items: ReactNode[] = [];
  if (parts.includes("kind") && (draft.sector || draft.styles?.length)) items.push(<li key="kind"><b>업종·유형</b> {[draft.sector, ...(draft.styles ?? [])].filter(Boolean).join(" · ")}</li>);
  if (parts.includes("one") && draft.one) items.push(<li key="one"><b>한 줄</b> {draft.one}</li>);
  if (parts.includes("model")) {
    if (draft.lines?.length) items.push(<li key="lines"><b>매출 비중</b> {draft.lines.map((l) => `${l.name} 약 ${l.pct}%`).join(" · ")}</li>);
    if (draft.customers) items.push(<li key="c"><b>주요 고객</b> {draft.customers}</li>);
    if (draft.power) items.push(<li key="p"><b>가격 결정력</b> {draft.power}{draft.powerWhy ? ` · ${draft.powerWhy}` : ""}</li>);
  }
  if (parts.includes("promises")) {
    if (typeof draft.promises === "string" && draft.promises) items.push(<li key="pr"><b>경영진 약속 찾을 곳</b> {draft.promises}</li>);
    draftPromises(draft).forEach((p, i) => items.push(<li key={`p${i}`}><b>{p.when || "최근"}</b> “{p.said}”</li>));
  }
  if (parts.includes("events")) draft.events?.forEach((e, i) => items.push(<li key={`e${i}`}><b>{e.when}</b> {e.text}</li>));
  if (parts.includes("numbers") && draft.numbersNote) items.push(<li key="num"><b>숫자 읽기</b> {draft.numbersNote}</li>);
  if (parts.includes("moat") && draft.moat) items.push(<li key="moat"><b>강점</b> {draft.moat}</li>);
  if (parts.includes("risks")) draft.risks?.forEach((r, i) => items.push(<li key={`r${i}`}>{r.text}{r.signal && <span className="muted"> → 신호: {r.signal}</span>}</li>));
  if (parts.includes("price") && (draft.cheap || draft.pricey || draft.priceWhy)) items.push(
    <li key="price"><b>가격</b> {[draft.cheap && `싸다 ${draft.cheap.toLocaleString()} 이하`, draft.pricey && `비싸다 ${draft.pricey.toLocaleString()} 이상`].filter(Boolean).join(" · ")}{draft.priceWhy && <span className="muted"> · {draft.priceWhy}</span>}</li>,
  );
  if (parts.includes("conclusion") && draft.conclusion) items.push(<li key="con" className="study-text"><b>정리</b> {draft.conclusion}</li>);
  if (parts.includes("sources") && draft.sources?.length) items.push(<li key="src"><b>찾아본 자료</b> {draft.sources.map((x) => x.title).join(" · ")}</li>);
  if (items.length === 0) return null;
  return (
    <div className="study-draft">
      <div className="study-draft-head"><b>✨ AI 초안 (참고용, 확인 필요)</b><button type="button" className="chip-btn" onClick={onUse}>빈 칸에 넣기</button></div>
      <ul>{items}</ul>
    </div>
  );
}

// ---------------------------------------------------------------- A: 한 장 노트(다 적은 뒤 보고 고치기)
function OnePage({ note, fields, setFields, save, draft, money_ }: {
  note: NoteData; fields: Fields; setFields: Set; save: (f: Fields) => Promise<boolean>; draft: Draft | null; money_: (v: number) => string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [work, setWork] = useState(fields);
  const [history, setHistory] = useState(false);
  const before = useRef(fields);
  const now = new Date(`${note.today}T12:00:00+09:00`);
  const past = pastSelf(note.versions, now, note.price);

  function open(key: string) { before.current = fields; setWork(fields); setEditing(key); }
  async function done() { if (await save(work)) { setFields(work); setEditing(null); } }
  function cancel() { setWork(before.current); setEditing(null); }
  const sec = (key: string, n: string, title: string, view: ReactNode, editor: (f: Fields, set: Set) => ReactNode, opts: { auto?: boolean; parts?: string[] } = {}) => (
    <Sec n={n} title={title} auto={opts.auto} onEdit={editing === null ? () => open(key) : undefined}>
      {editing === key ? (
        <>
          {draft && opts.parts && <DraftBox draft={draft} parts={opts.parts} onUse={() => setWork(applyDraft(work, draft, opts.parts!))} />}
          {editor(work, setWork)}
          <div className="study-edit-acts"><button type="button" onClick={done}>저장</button><button type="button" className="soft" onClick={cancel}>취소</button></div>
        </>
      ) : view}
    </Sec>
  );
  const f = fields;
  const empty = <p className="muted study-empty">아직 안 적었어요.</p>;
  const split = splitOf(f.lines);

  return (
    <div className="study-page">
      <div className="study-cols">
        <div className="study-col">
          {sec("one", "①", "한 줄로 말하면", f.one ? <p className="study-text big">{f.one}</p> : empty, (w, s) => <OneEd f={w} set={s} />, { parts: ["one"] })}
          {sec("model", "②", "돈 버는 구조", (
            f.lines.length || f.customers || f.power ? (
              <>
                {split.length > 0 && <SplitBar split={split} />}
                {f.customers && <p className="study-text"><span className="study-lab">주요 고객</span> {f.customers}</p>}
                {f.power && <p className="study-text"><span className="study-lab">가격 결정력</span> <b>{f.power}</b>{f.powerWhy && <span className="muted"> · {f.powerWhy}</span>}</p>}
              </>
            ) : empty
          ), (w, s) => <ModelEd f={w} set={s} />, { parts: ["model"] })}
          {sec("numbers", "③", "숫자가 뒷받침하나", <><NumbersView n={note.numbers} market={note.market} />{f.numbersNote && <p className="study-text study-mine">{f.numbersNote}</p>}</>,
            (w, s) => <><NumbersView n={note.numbers} market={note.market} /><NumbersEd f={w} set={s} /></>, { auto: true, parts: ["numbers"] })}
          {sec("peers", "④", "경쟁사와 비교", <><PeersView note={note} />{f.moat ? <p className="study-text study-mine"><span className="study-lab">이 회사만의 강점</span> {f.moat}</p> : null}</>,
            (w, s) => <><PeersView note={note} edit /><MoatEd f={w} set={s} /></>, { auto: true, parts: ["moat"] })}
          {sec("promises", "⑤", "경영진이 한 말 · 지켰나", f.promises.length ? (
            <ul className="study-rows">{f.promises.map((p, i) => (
              <li key={i}><span className="muted">{p.when}</span> “{p.said}” <span className={`study-res r-${p.result}`}>{RESULTS.find((r) => r.key === p.result)?.label}</span></li>
            ))}</ul>
          ) : empty, (w, s) => <PromisesEd f={w} set={s} filings={note.filings} />, { parts: ["promises"] })}
        </div>
        <div className="study-col">
          {sec("risks", "⑦", "내가 틀릴 수 있는 이유", f.risks.some((r) => r.text) ? (
            <ol className="study-risks">{f.risks.filter((r) => r.text).map((r, i) => (
              <li key={i}>{r.text}{r.signal && <div className="muted practice-small">→ 이게 보이면 다시 생각: {r.signal}</div>}</li>
            ))}</ol>
          ) : empty, (w, s) => <RisksEd f={w} set={s} />, { parts: ["risks"] })}
          {sec("events", "⑥", "앞으로 일어날 일", f.events.length ? (
            <ul className="study-rows">{f.events.map((e, i) => <li key={i}>{e.day && <span className="muted">{dot(e.day)} </span>}{e.text}{e.day && e.day >= note.today && <span className="study-tag">일정에 표시</span>}</li>)}</ul>
          ) : empty, (w, s) => <EventsEd f={w} set={s} app={note.events} />, { parts: ["events"] })}
          {sec("price", "⑧", "내 가격 생각", f.cheap || f.pricey || f.priceWhy ? <PriceView f={f} note={note} money_={money_} /> : empty, (w, s) => <PriceEd f={w} set={s} note={note} money_={money_} />, { parts: ["price"] })}
          {sec("conclusion", "⑨", "결론", f.conclusion || f.verdict ? (
            <>
              {f.conclusion && <p className="study-text">{f.conclusion}</p>}
              {f.verdict ? <p className="study-text"><span className="study-lab">판단</span> <b className="study-verdict">{verdictLabel(f.verdict)}</b></p>
                : <p className="muted practice-small">판단(산다·기다린다·안 산다)은 ✎ 고치기에서 직접 골라 주세요.</p>}
            </>
          ) : empty, (w, s) => <ConclusionEd f={w} set={s} />, { parts: ["conclusion"] })}
          {sec("sources", "⑩", "자료·출처", f.sources.length ? (
            <ul className="study-rows">{f.sources.map((x, i) => <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.title || x.url}</a> : x.title}</li>)}</ul>
          ) : empty, (w, s) => <SourcesEd f={w} set={s} />, { parts: ["sources"] })}
          {past && (
            <div className="panel study-past">
              <b>🕰 {pastLabel(past)}</b>
              <p className="study-text">
                {dot(past.version.saved_at.slice(0, 10))} · 판단 <b>{verdictLabel(past.version.fields.verdict) || "안 적음"}</b>
                {past.version.fields.cheap && <> · 싸다 {money_(past.version.fields.cheap)}</>} · 확신 {past.version.confidence}/5
              </p>
              {past.change !== null && <p className="study-text">그 뒤 주가 <b className={past.change > 0 ? "up" : past.change < 0 ? "down" : ""}>{pct(past.change, true)}</b>
                {past.version.fields.cheap && note.price !== null && (note.price <= past.version.fields.cheap ? " · 싸다 가격 아래로 왔어요." : " · 싸다 가격엔 아직 안 왔어요.")}</p>}
              {past.version.fields.conclusion && <p className="muted practice-small">그때 결론: {past.version.fields.conclusion}</p>}
            </div>
          )}
        </div>
      </div>
      {note.versions.length > 0 && (
        <div className="panel study-versions">
          <button type="button" className="ghost" onClick={() => setHistory((h) => !h)}>{history ? "버전 접기" : `지난 버전 ${note.versions.length}개 보기`}</button>
          {history && (
            <ul className="study-rows">{[...note.versions].reverse().map((v) => (
              <li key={v.id}><span className="muted">{dot(v.saved_at.slice(0, 10))}</span> 판단 <b>{verdictLabel(v.fields.verdict) || "-"}</b> · 확신 {v.confidence}/5
                {v.price !== null && <> · 그때 주가 {money_(v.price)}</>}{v.fields.conclusion && <div className="muted practice-small">{v.fields.conclusion}</div>}</li>
            ))}</ul>
          )}
        </div>
      )}
      <form action={deleteStudy} className="study-delete" onSubmit={(e) => { if (!confirm(`${note.name} 노트를 지울까요? 버전도 같이 지워져요.`)) e.preventDefault(); }}>
        <input type="hidden" name="ticker" value={note.ticker} />
        <button type="submit" className="ghost">노트 지우기</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- 칸 모양
function Sec({ n, title, auto, onEdit, children }: { n: string; title: string; auto?: boolean; onEdit?: () => void; children: ReactNode }) {
  return (
    <section className="panel study-sec">
      <div className="study-sec-head">
        <h4><span className="study-n">{n}</span> {title}</h4>
        <span className={`study-who${auto ? " auto" : ""}`}>{auto ? "앱이 채움" : "내가 적기"}</span>
        {onEdit && <button type="button" className="chip-btn" onClick={onEdit}>✎ 고치기</button>}
      </div>
      {children}
    </section>
  );
}

function SplitBar({ split }: { split: { name: string; pct: number; other?: boolean }[] }) {
  const COLORS = ["#c9a96b", "#86a8e6", "#b48ead", "#5fbf9a", "#e0b25a", "#9b968b", "#e8806f", "#c4bfb4"];
  return (
    <>
      <div className="study-split" role="img" aria-label={split.map((s) => `${s.name} ${s.pct}%`).join(", ")}>
        {split.map((s, i) => <i key={i} style={{ width: `${s.pct}%`, background: s.other ? "#55524b" : COLORS[i % COLORS.length] }} title={`${s.name} ${s.pct}%`} />)}
      </div>
      <div className="study-legend">{split.map((s, i) => (
        <span key={i}><i style={{ background: s.other ? "#55524b" : COLORS[i % COLORS.length] }} />{s.name} {Math.round(s.pct)}%</span>
      ))}</div>
    </>
  );
}

function NumbersView({ n, market }: { n: Numbers | null; market: string }) {
  if (!n) return <p className="muted study-empty">재무제표를 아직 못 받았어요. 워커가 사업보고서(국내)·SEC 자료(미국)를 받는 중이에요.</p>;
  const series: [string, (number | null)[]][] = [["매출", n.revenue], ["영업이익", n.op], ["영업현금흐름", n.cfo]];
  return (
    <div className="study-nums">
      <div className="study-bars">
        {series.map(([label, vals]) => (
          <div key={label} className="study-bar-group">
            <div className="study-lab">{label} <span className="muted">{money(vals.at(-1) ?? null, market)}</span></div>
            <div className="study-mbar">
              {bars(vals).map((h, i) => (
                <i key={i} className={h !== null && h < 0 ? "neg" : ""} style={{ height: `${h === null ? 0 : Math.max(4, Math.abs(h))}%` }} title={`${n.years[i]} ${money(vals[i], market)}`} />
              ))}
            </div>
            <div className="study-years">{n.years.map((y) => <span key={y}>{y.slice(-2)}</span>)}</div>
          </div>
        ))}
      </div>
      <div className="study-num-facts">
        <span>영업이익률 <b>{pct(n.margin)}</b></span>
        <span>부채비율 <b>{pct(n.debt)}</b></span>
        {n.together !== null && <span className={n.together ? "study-ok" : "practice-warn"}>{n.together ? "✓ 이익과 현금이 같은 쪽으로 움직여요" : "⚠ 이익과 현금이 따로 움직여요"}</span>}
      </div>
    </div>
  );
}

function PeersView({ note, edit }: { note: NoteData; edit?: boolean }) {
  const rows = note.peers;
  return (
    <div className="study-peers">
      {rows.length > 1 || rows[0]?.ready ? (
        <table className="study-table">
          <thead><tr><th /><th>영업이익률</th><th>매출 성장</th><th>부채비율</th>{edit && <th />}</tr></thead>
          <tbody>{rows.map((p, i) => (
            <tr key={p.ticker} className={i === 0 ? "me" : ""}>
              <td>{p.name}</td>
              {p.ready ? <><td>{pct(p.margin)}</td><td>{pct(p.growth, true)}</td><td>{pct(p.debt)}</td></> : <td colSpan={3} className="muted">재무 받는 중</td>}
              {edit && <td>{i > 0 && (
                <form action={removeStudyPeer}><input type="hidden" name="ticker" value={note.ticker} /><input type="hidden" name="peerTicker" value={p.ticker} /><button type="submit" className="ghost" aria-label={`${p.name} 빼기`}>✕</button></form>
              )}</td>}
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="muted study-empty">비교할 경쟁사를 넣으면 이익률·성장·빚을 나란히 보여 줘요.</p>}
      {edit && (
        <form action={addStudyPeer} className="study-peer-add">
          <input type="hidden" name="ticker" value={note.ticker} />
          <input name="peerTicker" placeholder={note.market === "US" ? "경쟁사 티커 (MU)" : "경쟁사 코드 (005930)"} required />
          <input name="peerName" placeholder="이름" />
          <button type="submit" className="soft">경쟁사 넣기</button>
        </form>
      )}
    </div>
  );
}

function PriceView({ f, note, money_ }: { f: Fields; note: NoteData; money_: (v: number) => string }) {
  const gap = f.cheap && note.price ? Math.round((f.cheap / note.price - 1) * 1000) / 10 : null;
  return (
    <>
      <div className="study-prices">
        {f.cheap && <div><span className="study-lab">싸다</span> <b className="down">{money_(f.cheap)} 이하</b></div>}
        {f.pricey && <div><span className="study-lab">비싸다</span> <b className="up">{money_(f.pricey)} 이상</b></div>}
        {note.price !== null && <div><span className="study-lab">지금</span> <b>{money_(note.price)}</b>{gap !== null && <span className="muted"> · 싸다까지 {pct(gap, true)}</span>}</div>}
      </div>
      {f.priceWhy && <p className="study-text muted">{f.priceWhy}</p>}
      {f.cheap && <AlertButton ticker={note.ticker} price={f.cheap} on={note.alerts.some((a) => Math.abs(a - f.cheap!) < 1e-6)} money_={money_} />}
    </>
  );
}

function AlertButton({ ticker, price, on, money_ }: { ticker: string; price: number; on: boolean; money_: (v: number) => string }) {
  const [state, setState] = useState<"" | "on" | "fail">(on ? "on" : "");
  if (state === "on") return <p className="study-ok practice-small">🔔 {money_(price)} 아래로 오면 텔레그램으로 알려 드려요.</p>;
  return (
    <button type="button" className="chip-btn" onClick={async () => setState((await studyAlert({ ticker, price }).catch(() => false)) ? "on" : "fail")}>
      🔔 {money_(price)} 오면 알림{state === "fail" && " (실패, 다시 눌러 주세요)"}
    </button>
  );
}

// ---------------------------------------------------------------- 적는 칸
function OneEd({ f, set }: { f: Fields; set: Set }) {
  return (
    <>
      <textarea value={f.one} onChange={(e) => set({ ...f, one: e.target.value })} rows={2} placeholder="이 회사는 ___을 ___에게 팔아서 돈을 번다" />
      <p className="muted practice-small">예: 메모리 반도체(D램·낸드)를 만들어 서버·스마트폰 회사에 팔아요. 요즘은 AI 서버용 HBM이 이익의 절반이에요.</p>
    </>
  );
}

function ModelEd({ f, set }: { f: Fields; set: Set }) {
  const lines = f.lines.length ? f.lines : [{ name: "", pct: 0 }];
  const put = (i: number, v: Partial<{ name: string; pct: number }>) => set({ ...f, lines: lines.map((l, k) => (k === i ? { ...l, ...v } : l)) });
  const split = splitOf(f.lines.filter((l) => l.name));
  return (
    <div className="study-form">
      <div className="study-lab">매출 비중 <span className="muted">사업보고서 '매출 현황'이나 실적 발표 자료에 있어요</span></div>
      {lines.map((l, i) => (
        <div key={i} className="study-line">
          <input value={l.name} onChange={(e) => put(i, { name: e.target.value })} placeholder="사업 (예: D램)" />
          <input value={l.pct || ""} onChange={(e) => put(i, { pct: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} inputMode="decimal" placeholder="%" className="study-pct" />
          <button type="button" className="ghost" onClick={() => set({ ...f, lines: lines.filter((_, k) => k !== i) })} aria-label="줄 지우기">✕</button>
        </div>
      ))}
      <button type="button" className="chip-btn" onClick={() => set({ ...f, lines: [...lines, { name: "", pct: 0 }] })}>＋ 사업 추가</button>
      {split.length > 0 && <SplitBar split={split} />}
      <label className="study-lab">주요 고객<input value={f.customers} onChange={(e) => set({ ...f, customers: e.target.value })} placeholder="누가 사 가나요? (예: 엔비디아·애플·서버 업체)" /></label>
      <div className="study-lab">가격을 올릴 힘 (가격 결정력)</div>
      <div className="segment study-seg" role="radiogroup" aria-label="가격 결정력">
        {(["강함", "보통", "약함"] as const).map((p) => <button key={p} type="button" aria-selected={f.power === p} onClick={() => set({ ...f, power: f.power === p ? "" : p })}>{p}</button>)}
      </div>
      <input value={f.powerWhy} onChange={(e) => set({ ...f, powerWhy: e.target.value })} placeholder="왜 그렇게 생각해요? (예: 메모리 값이 오르내리는 대로 따라가요)" />
    </div>
  );
}

function PromisesEd({ f, set, filings }: { f: Fields; set: Set; filings: { day: string; title: string }[] }) {
  const rows = f.promises;
  const put = (i: number, v: Partial<Fields["promises"][number]>) => set({ ...f, promises: rows.map((r, k) => (k === i ? { ...r, ...v } : r)) });
  return (
    <div className="study-form">
      {rows.map((r, i) => (
        <div key={i} className="study-line">
          <input value={r.when} onChange={(e) => put(i, { when: e.target.value })} placeholder="2026.07" className="study-when" />
          <input value={r.said} onChange={(e) => put(i, { said: e.target.value })} placeholder="한 말 (예: HBM4 하반기 양산)" />
          <select value={r.result} onChange={(e) => put(i, { result: e.target.value as Fields["promises"][number]["result"] })} aria-label="지켰나">
            {RESULTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <button type="button" className="ghost" onClick={() => set({ ...f, promises: rows.filter((_, k) => k !== i) })} aria-label="줄 지우기">✕</button>
        </div>
      ))}
      <button type="button" className="chip-btn" onClick={() => set({ ...f, promises: [...rows, { when: "", said: "", result: "wait" }] })}>＋ 한 말 추가</button>
      {filings.length > 0 && <div className="muted practice-small">최근 공시: {filings.map((x) => `${x.day} ${x.title}`).join(" · ")}</div>}
      <p className="muted practice-small">실적 발표 때마다 한 줄씩 남기면, 말한 대로 하는 경영진인지 쌓여서 보여요.</p>
    </div>
  );
}

function EventsEd({ f, set, app }: { f: Fields; set: Set; app: { day: string; title: string }[] }) {
  const rows = f.events;
  const put = (i: number, v: Partial<Fields["events"][number]>) => set({ ...f, events: rows.map((r, k) => (k === i ? { ...r, ...v } : r)) });
  const missing = app.filter((a) => !rows.some((r) => r.day === a.day && r.text === a.title));
  return (
    <div className="study-form">
      {rows.map((r, i) => (
        <div key={i} className="study-line">
          <input type="date" value={r.day} onChange={(e) => put(i, { day: e.target.value })} aria-label="날짜 (모르면 비워 두세요)" className="study-when" />
          <input value={r.text} onChange={(e) => put(i, { text: e.target.value })} placeholder="일 (예: 4분기 실적 발표, HBM4 인증)" />
          <button type="button" className="ghost" onClick={() => set({ ...f, events: rows.filter((_, k) => k !== i) })} aria-label="줄 지우기">✕</button>
        </div>
      ))}
      <button type="button" className="chip-btn" onClick={() => set({ ...f, events: [...rows, { day: "", text: "" }] })}>＋ 일 추가</button>
      {missing.length > 0 && (
        <div className="study-suggest">앱 일정에 있는 일: {missing.map((a) => (
          <button key={a.day + a.title} type="button" className="chip-btn" onClick={() => set({ ...f, events: [...rows, { day: a.day, text: a.title }] })}>＋ {dot(a.day)} {a.title}</button>
        ))}</div>
      )}
      <p className="muted practice-small">날짜를 넣은 일은 일정 탭에도 📒로 보여요.</p>
    </div>
  );
}

function NumbersEd({ f, set }: { f: Fields; set: Set }) {
  return <textarea value={f.numbersNote} onChange={(e) => set({ ...f, numbersNote: e.target.value })} rows={2} placeholder="숫자를 보고 느낀 점 (예: 2023년 적자는 메모리 값 폭락 때문. 사이클 업종이라 좋은 해 숫자만 보면 안 돼요)" />;
}

function MoatEd({ f, set }: { f: Fields; set: Set }) {
  return (
    <label className="study-lab">이 회사만의 강점 (해자)
      <textarea value={f.moat} onChange={(e) => set({ ...f, moat: e.target.value })} rows={2} placeholder="경쟁사가 쉽게 못 따라 하는 것 (예: HBM 점유율 1위, 기술 격차 1~2년)" />
    </label>
  );
}

function RisksEd({ f, set }: { f: Fields; set: Set }) {
  const put = (i: number, v: Partial<{ text: string; signal: string }>) => set({ ...f, risks: f.risks.map((r, k) => (k === i ? { ...r, ...v } : r)) });
  return (
    <div className="study-form">
      {f.risks.map((r, i) => (
        <div key={i} className="study-risk">
          <input value={r.text} onChange={(e) => put(i, { text: e.target.value })} placeholder={`${i + 1}. 틀릴 수 있는 이유 (예: 메모리 값이 다시 빠진다)`} />
          <input value={r.signal} onChange={(e) => put(i, { signal: e.target.value })} placeholder="→ 이게 보이면 다시 생각 (예: D램 고정가 2달 연속 하락)" />
        </div>
      ))}
      {f.risks.length < 5 && <button type="button" className="chip-btn" onClick={() => set({ ...f, risks: [...f.risks, { text: "", signal: "" }] })}>＋ 이유 추가</button>}
    </div>
  );
}

function PriceEd({ f, set, note, money_ }: { f: Fields; set: Set; note: NoteData; money_: (v: number) => string }) {
  const num = (v: string) => { const n = Number(v.replace(/[^\d.]/g, "")); return n > 0 ? n : null; };
  return (
    <div className="study-form">
      <div className="study-line">
        <label className="study-lab">싸다 (이 아래면)<input value={f.cheap ?? ""} onChange={(e) => set({ ...f, cheap: num(e.target.value) })} inputMode="decimal" placeholder={note.market === "US" ? "$" : "원"} /></label>
        <label className="study-lab">비싸다 (이 위면)<input value={f.pricey ?? ""} onChange={(e) => set({ ...f, pricey: num(e.target.value) })} inputMode="decimal" placeholder={note.market === "US" ? "$" : "원"} /></label>
      </div>
      <p className="muted practice-small">지금 {note.price !== null ? money_(note.price) : "-"}{note.value && ` · ${note.value}`}</p>
      <input value={f.priceWhy} onChange={(e) => set({ ...f, priceWhy: e.target.value })} placeholder="왜 그 가격이에요? (예: PER 8배, 지난 5년 밴드 아래쪽)" />
      {f.cheap && <AlertButton ticker={note.ticker} price={f.cheap} on={note.alerts.some((a) => Math.abs(a - f.cheap!) < 1e-6)} money_={money_} />}
    </div>
  );
}

function ConclusionEd({ f, set }: { f: Fields; set: Set }) {
  return (
    <div className="study-form">
      <textarea value={f.conclusion} onChange={(e) => set({ ...f, conclusion: e.target.value })} rows={4} placeholder="5줄 안에. 왜 사고 싶은지(또는 아닌지), 어떤 가격이면 어떻게 할지" />
      <div className="study-lab">판단</div>
      <div className="segment study-seg" role="radiogroup" aria-label="판단">
        {VERDICTS.map((v) => <button key={v.key} type="button" aria-selected={f.verdict === v.key} onClick={() => set({ ...f, verdict: f.verdict === v.key ? "" : v.key })}>{v.label}</button>)}
      </div>
    </div>
  );
}

function SourcesEd({ f, set }: { f: Fields; set: Set }) {
  const rows = f.sources;
  const put = (i: number, v: Partial<{ title: string; url: string }>) => set({ ...f, sources: rows.map((r, k) => (k === i ? { ...r, ...v } : r)) });
  return (
    <div className="study-form">
      {rows.map((r, i) => (
        <div key={i} className="study-line">
          <input value={r.title} onChange={(e) => put(i, { title: e.target.value })} placeholder="자료 이름 (예: 2025 사업보고서)" />
          <input value={r.url} onChange={(e) => put(i, { url: e.target.value })} placeholder="https://" inputMode="url" />
          <button type="button" className="ghost" onClick={() => set({ ...f, sources: rows.filter((_, k) => k !== i) })} aria-label="줄 지우기">✕</button>
        </div>
      ))}
      <button type="button" className="chip-btn" onClick={() => set({ ...f, sources: [...rows, { title: "", url: "" }] })}>＋ 자료 추가</button>
    </div>
  );
}
