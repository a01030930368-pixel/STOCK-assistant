"use client";
// 기업 공부 › 가설 탭: 가설 카드 보드(A) + 실적 날 점검·다가오는 확인 날·지난 실적 발표 기록(C)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addThesisMemo, askThesisScan, deleteEvidence, deleteThesis, finishReview, saveThesis, setThesisStatus } from "@/app/actions";
import { money } from "@/lib/statements";
import {
  counts, isOpen, meter, METRICS, metricRule, pendingSuggestion, reviewTitle, sortTheses, STATUS_WORD,
  type HistoryRow, type Review, type ReviewItem, type Seed, type Status, type Thesis, type Upcoming,
} from "@/lib/thesis";
import { actualLine, betLine, resultMarks, type Bet } from "@/lib/bets";
import BetCard, { type BetData } from "./BetCard";

const dot = (d: string) => d.slice(5).replace("-", ".");
const fullDot = (d: string) => d.replaceAll("-", ".");
const SIGN = { up: { mark: "✓", cls: "th-ok" }, down: { mark: "✗", cls: "th-no" }, neutral: { mark: "·", cls: "muted" } } as const;
const PICK: Status[] = ["ok", "watch", "bad", "right", "wrong"];

export type ThesisData = {
  ticker: string; name: string; market: "KR" | "US"; theses: Thesis[]; seeds: Seed[]; review: (Review & { rows: ReviewItem[] }) | null;
  history: HistoryRow[]; upcoming: Upcoming[]; aiKey: boolean; today: string; bet: BetData;
};

export default function ThesisBoard({ data }: { data: ThesisData }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [asked, setAsked] = useState(false);
  const [, start] = useTransition();
  const c = counts(data.theses);
  const sorted = sortTheses(data.theses);
  const open = sorted.filter((t) => isOpen(t.status)), closed = sorted.filter((t) => !isOpen(t.status));
  const refresh = () => start(() => router.refresh());

  return (
    <div className="th-board">
      {data.review && <ReviewPanel review={data.review} onDone={refresh} />}
      <BetCard key={data.bet.period} ticker={data.ticker} market={data.market} data={data.bet} today={data.today} onSaved={refresh} />

      <div className="th-sum">
        <div><b>{c.open}</b>지금 보는 가설</div>
        <div><b className="th-ok">{c.ok}</b>맞아 가는 중</div>
        <div><b>{c.watch}</b>지켜보는 중</div>
        <div><b className="th-no">{c.bad}</b>흔들림</div>
        <div><b className="gold">{c.right + c.wrong}</b>끝남 (맞음 {c.right} · 틀림 {c.wrong})</div>
      </div>
      <div className="th-actions">
        <button type="button" onClick={() => setForm(form ? null : { ticker: data.ticker, metric: "", op: ">=" })}>＋ 가설 추가</button>
        {data.aiKey && (
          <button type="button" className="secondary" disabled={asked || !open.some((t) => !t.metric)}
            onClick={async () => { setAsked(true); await askThesisScan(data.ticker); }}>
            {asked ? "AI가 새 자료를 보는 중이에요. 잠시 뒤 새로 고쳐 보세요" : "✨ 새 자료로 다시 보기"}
          </button>
        )}
        <span className="muted th-hint">실적·공시·뉴스가 오면 AI가 관련 있는 근거를 붙이고 판정을 제안해요. 정하는 건 나예요.</span>
      </div>

      {form && <ThesisForm initial={form} seeds={data.seeds} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}

      {data.theses.length === 0 && !form && (
        <div className="panel th-empty">
          <b>가설이 아직 없어요</b>
          <p className="muted">
            가설은 &ldquo;확인할 수 있는 문장 + 기준 + 날짜&rdquo;예요. 예: &ldquo;HBM이 영업이익의 절반 이상을 계속 낸다 · 실적 발표에서 HBM 비중 40% 이상 · 2027.01.28&rdquo;.
            영업이익률·성장률처럼 숫자로 적으면 분기 숫자가 나올 때 앱이 직접 맞춰 봐요.
          </p>
          {data.seeds.length > 0 && <p className="muted">노트의 ⑦ 틀릴 이유, ⑤ 경영진 약속, ⑥ 앞으로 일에서 바로 만들 수도 있어요. ＋ 가설 추가를 눌러 보세요.</p>}
        </div>
      )}

      <div className="th-grid">
        {open.map((t) => <ThesisCard key={t.id} t={t} today={data.today} onEdit={() => setForm(toForm(t, data.ticker))} onChanged={refresh} />)}
      </div>
      {closed.length > 0 && (
        <details className="th-closed">
          <summary>끝난 가설 {closed.length}개 (맞음 {c.right} · 틀림 {c.wrong})</summary>
          <div className="th-grid">{closed.map((t) => <ThesisCard key={t.id} t={t} today={data.today} onEdit={() => setForm(toForm(t, data.ticker))} onChanged={refresh} />)}</div>
        </details>
      )}

      <div className="th-two">
        <section className="panel th-upcoming">
          <h3>다가오는 확인 날</h3>
          {data.upcoming.length === 0 ? <p className="muted">가설에 확인 날짜를 넣거나 실적 발표 일정이 잡히면 여기에 보여요.</p> : (
            <ul>{data.upcoming.map((u, i) => (
              <li key={i}><span className="muted">{fullDot(u.day)}</span><span>{u.text}</span><span className={`th-pill ${u.tone}`}>{u.tag}</span></li>
            ))}</ul>
          )}
        </section>
        <EarningsHistory rows={data.history} market={data.market} bets={data.bet.past} />
      </div>
    </div>
  );
}

const toForm = (t: Thesis, ticker: string): Record<string, string> => ({
  ticker, id: String(t.id), title: t.title, rule: t.rule, dueOn: t.dueOn ?? "", metric: t.metric ?? "", op: t.op ?? ">=", target: t.target === null ? "" : String(t.target),
});

// ---------------------------------------------------------------- 카드

function ThesisCard({ t, today, onEdit, onChanged }: { t: Thesis; today: string; onEdit: () => void; onChanged: () => void }) {
  const [more, setMore] = useState(false);
  const [memo, setMemo] = useState<string | null>(null);
  const [sign, setSign] = useState("neutral");
  const m = meter(t);
  const ev = [...t.evidence].sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id);
  const shown = more ? ev : ev.slice(0, 3);
  const rule = t.metric ? metricRule(t) : t.rule;
  const overdue = t.dueOn && t.dueOn <= today && isOpen(t.status);
  const act = async (fn: () => Promise<unknown>) => { await fn(); onChanged(); };

  return (
    <article className={`th-card s-${t.status}`}>
      <div className="th-card-head">
        <b>{t.title}</b>
        <span className={`th-pill s-${t.status}`}>{t.status === "right" ? "✓ 맞음" : t.status === "wrong" ? "✗ 틀림" : STATUS_WORD[t.status]}</span>
      </div>
      {rule && <div><span className="th-k">확인 기준</span>{rule}</div>}
      {t.dueOn && <div><span className="th-k">언제까지</span>{fullDot(t.dueOn)}{overdue && <b className="th-no"> · 확인 날이 됐어요</b>}</div>}
      {m && (
        <div className="th-meter-wrap">
          <div className="th-meter"><i className={m.ok ? "ok" : "no"} style={{ width: `${m.fill}%` }} /><b style={{ left: `${m.mark}%` }} /></div>
          <div className="th-meter-lab muted"><span>기준 {t.target}% {t.op === ">=" ? "이상" : "이하"}</span><span>지금 {m.now.toFixed(1)}%</span></div>
        </div>
      )}
      {ev.length > 0 ? (
        <ul className="th-ev">
          {shown.map((e) => {
            const [raw, note] = e.text.split("\n→ ");
            const head = raw.replace(/\s[✓✗]$/, "");
            return (
              <li key={e.id}>
                <span className="muted">{dot(e.day)}</span>
                <span className={SIGN[e.sign].cls}>{SIGN[e.sign].mark}</span>
                <span className="th-ev-text">
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{head}</a> : head}
                  {note && <span className="th-ev-note">→ {note}</span>}
                </span>
                {e.kind === "memo" && <button type="button" className="ghost th-x" aria-label="메모 지우기" onClick={() => act(() => deleteEvidence(e.id))}>×</button>}
              </li>
            );
          })}
          {ev.length > 3 && <li><button type="button" className="link" onClick={() => setMore(!more)}>{more ? "접기" : `근거 ${ev.length - 3}개 더 보기`}</button></li>}
        </ul>
      ) : (
        <p className="muted th-small">{t.metric ? "분기 숫자가 들어오면 앱이 맞춰 봐요." : t.scanned ? "아직 관련 자료가 없어요." : "AI가 최근 한 달 자료를 살펴보는 중이에요."}</p>
      )}
      {t.ai && isOpen(t.status) && (
        <div className="th-ai">
          ✨ {t.ai.by === "metric" ? "숫자" : "AI"} 제안: <b>{STATUS_WORD[t.ai.status]}</b> · {t.ai.why.replace(/\s[✓✗]$/, "")}
          {pendingSuggestion(t) && <button type="button" className="chip-btn" onClick={() => act(() => setThesisStatus(t.id, t.ai!.status))}>이대로 정하기</button>}
        </div>
      )}
      <div className="segment th-seg" role="radiogroup" aria-label="내 판정">
        {PICK.map((s) => (
          <button key={s} type="button" aria-selected={t.status === s} onClick={() => act(() => setThesisStatus(t.id, s))}>{STATUS_WORD[s]}</button>
        ))}
      </div>
      {memo !== null ? (
        <div className="th-memo">
          <textarea rows={2} value={memo} maxLength={500} placeholder="내가 본 근거 (예: 10.29 삼성 퀄 통과 기사, 아직 공식 발표는 없음)" onChange={(e) => setMemo(e.target.value)} />
          <div className="th-row">
            <select value={sign} onChange={(e) => setSign(e.target.value)} aria-label="어느 쪽 근거">
              <option value="up">✓ 가설 편</option><option value="neutral">· 중립</option><option value="down">✗ 반대쪽</option>
            </select>
            <button type="button" onClick={() => act(async () => { await addThesisMemo(t.id, memo, sign); setMemo(null); })} disabled={!memo.trim()}>메모 붙이기</button>
            <button type="button" className="secondary" onClick={() => setMemo(null)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="th-row th-tools">
          <button type="button" className="link" onClick={() => setMemo("")}>＋ 내 메모</button>
          <button type="button" className="link" onClick={onEdit}>고치기</button>
          <button type="button" className="link th-del" onClick={() => { if (confirm("이 가설과 근거를 지울까요?")) act(() => deleteThesis(t.id)); }}>지우기</button>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- 추가·고치기

function ThesisForm({ initial, seeds, onClose, onSaved }: { initial: Record<string, string>; seeds: Seed[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const editing = Boolean(v.id);
  return (
    <form className="panel th-form" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await saveThesis(v);
      setBusy(false);
      if (r.error) setError(r.error); else onSaved();
    }}>
      <b>{editing ? "가설 고치기" : "새 가설"}</b>
      {!editing && seeds.length > 0 && (
        <div className="th-seeds">
          <span className="muted">노트에서 가져오기</span>
          {seeds.map((s) => (
            <button key={s.key} type="button" className="chip-btn" onClick={() => setV((x) => ({
              ...x, title: s.input.title, rule: s.input.rule ?? "", dueOn: s.input.dueOn ?? x.dueOn ?? "", source: s.input.source ?? "self", metric: "",
            }))}>{s.label}</button>
          ))}
        </div>
      )}
      <label>가설 (확인할 수 있는 문장)
        <input value={v.title ?? ""} maxLength={200} required placeholder="예: HBM이 영업이익의 절반 이상을 계속 낸다" onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="th-form-row">
        <label>확인 방법
          <select value={v.metric ?? ""} onChange={(e) => set("metric", e.target.value)}>
            <option value="">글로 적기 (AI가 실적·공시·뉴스에서 근거 찾기)</option>
            {Object.entries(METRICS).map(([k, label]) => <option key={k} value={k}>숫자: {label}</option>)}
          </select>
        </label>
        {v.metric ? (
          <label className="th-target">기준
            <span className="th-row">
              <input inputMode="decimal" value={v.target ?? ""} placeholder="30" onChange={(e) => set("target", e.target.value)} />
              <span>%</span>
              <select value={v.op ?? ">="} onChange={(e) => set("op", e.target.value)}><option value=">=">이상</option><option value="<=">이하</option></select>
            </span>
          </label>
        ) : (
          <label>확인 기준 (무엇이 보이면 맞고 틀린지)
            <input value={v.rule ?? ""} maxLength={300} placeholder="예: 실적 발표에서 HBM 매출 비중 40% 이상" onChange={(e) => set("rule", e.target.value)} />
          </label>
        )}
        <label className="th-due">언제까지 (선택)
          <input type="date" value={v.dueOn ?? ""} onChange={(e) => set("dueOn", e.target.value)} />
        </label>
      </div>
      {v.metric && <p className="muted th-small">분기 숫자가 나올 때마다 앱이 {METRICS[v.metric as keyof typeof METRICS]}을 계산해서 근거로 붙이고, 기준을 못 넘으면 텔레그램으로 알려요.</p>}
      {error && <p className="th-no">{error}</p>}
      <div className="th-row">
        <button type="submit" disabled={busy}>{busy ? "저장 중…" : editing ? "고친 대로 저장" : "가설 저장"}</button>
        <button type="button" className="secondary" onClick={onClose}>취소</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- 실적 날 점검

function ReviewPanel({ review, onDone }: { review: Review & { rows: ReviewItem[] }; onDone: () => void }) {
  const [rows, setRows] = useState(review.rows);
  const [memo, setMemo] = useState(review.memo);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel th-review">
      <div className="th-review-head">
        <h3>📒 실적 날 점검 · {reviewTitle(review.period)}</h3>
        <span className="muted">{fullDot(review.day)} 발표</span>
      </div>
      {rows.length === 0 ? <p className="muted">지금 보는 가설이 없어요. 가설을 추가하면 다음 실적부터 여기서 맞춰 봐요.</p> : (
        <div className="th-table-wrap">
          <table className="th-table">
            <thead><tr><th>가설</th><th>지난번</th><th>이번 실적</th><th>제안</th><th>내 판정</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.thesis}>
                  <td className="th-t">{r.title}</td><td className="muted" data-l="지난번">{r.before}</td><td data-l="이번 실적"><div className="th-now">{r.now.replace(/\s[✓✗]$/, "")}</div></td>
                  <td className={r.aiStatus === "ok" ? "th-ok" : r.aiStatus === "bad" ? "th-no" : "muted"} data-l="제안">{r.ai}</td>
                  <td className="th-mine">
                    <div className="segment th-seg small-seg">
                      {(["ok", "watch", "bad", "right", "wrong"] as Status[]).map((s) => (
                        <button key={s} type="button" aria-selected={r.mine === s} onClick={() => setRows(rows.map((x, k) => (k === i ? { ...x, mine: s } : x)))}>{STATUS_WORD[s]}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <textarea rows={2} value={memo} maxLength={1000} placeholder="이번 실적 한 줄 메모 (예: HBM은 기대대로, 투자는 예상보다 많음. 결론은 그대로 기다린다)" onChange={(e) => setMemo(e.target.value)} />
      <div className="th-row">
        <span className="muted th-small">점검을 마치면 고른 판정이 가설에 반영되고, 아래 실적 발표 기록에 남아요.</span>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); await finishReview({ id: review.id, memo, items: rows }); setBusy(false); onDone(); }}>
          {busy ? "저장 중…" : "점검 끝"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 지난 실적 발표 기록

function Pct({ v }: { v: number }) {
  return <b className={v >= 0 ? "up" : "down"}>{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(1)}%</b>;
}

function EarningsHistory({ rows, market, bets }: { rows: HistoryRow[]; market: "KR" | "US"; bets: Bet[] }) {
  const m = (v: number | null) => money(v, market);
  const fmt = (v: number | null, kind: "money" | "eps") =>
    v === null ? "-" : kind === "money" ? m(v) : market === "US" ? `$${v.toFixed(2)}` : `${Math.round(v).toLocaleString("ko-KR")}원`;
  const noKrEst = market === "KR" && !rows.some((r) => r.est);
  return (
    <section className="panel th-history">
      <h3>실적 발표 기록</h3>
      {noKrEst && rows.length > 0 && <p className="muted th-small">국내 시장 예상치는 지난 값을 무료로 구할 곳이 없어요. 이제부터 발표 전 예상치를 매일 적어 두니, 다음 실적부터 예상과 비교해 보여 드려요.</p>}
      {rows.length === 0 ? <p className="muted">아직 모은 실적 발표가 없어요. 공부 노트를 만들면 하루 안에 지난 3년 치 발표 목록을 모아 와요.</p> : (
        <div className="th-hist">
          {rows.map((r, i) => (
            <details key={r.period} open={i === 0}>
              <summary>
                <b>{r.label}</b>
                <span className="muted">{r.day ? fullDot(r.day) : ""}</span>
                <span>매출 {m(r.revenue)}{r.revYoy && <span className={r.revYoy.tone}> {r.revYoy.text}</span>}</span>
                <span>영업이익 {m(r.op)}{r.opYoy && <span className={r.opYoy.tone}> {r.opYoy.text}</span>}</span>
                {r.review?.doneAt && <span className="th-pill g">점검함</span>}
              </summary>
              <div className="th-hist-body">
                {(() => {
                  const b = bets.find((x) => x.period === r.period);
                  return b ? (
                    <p className="th-hist-note bet-hist">
                      <span className="th-k">내 예상</span>{betLine(b)}
                      <span className="muted"> → {actualLine(b.result)} </span>
                      {resultMarks(b.result).map((m) => <span key={m.label} className={m.ok ? "th-ok" : m.ok === false ? "th-no" : "muted"}>{m.label} {m.ok ? "✓" : m.ok === false ? "✗" : "·"} </span>)}
                      {b.reason && <span className="muted"> · &ldquo;{b.reason}&rdquo;</span>}
                    </p>
                  ) : null;
                })()}
                {r.est && r.est.items.length > 0 && (
                  <div className="th-hist-block">
                    <span className="th-k">시장 예상과 비교</span>
                    <table className="th-hist-table">
                      <thead><tr><th></th><th>예상</th><th>실제</th><th>차이</th></tr></thead>
                      <tbody>{r.est.items.map((it) => (
                        <tr key={it.label}>
                          <th>{it.label}</th><td>{fmt(it.estimate, it.kind)}</td><td><b>{fmt(it.actual, it.kind)}</b></td>
                          <td>{it.pct === null ? "-" : <span className={it.pct >= 0 ? "up" : "down"}>{it.pct >= 0 ? "+" : "−"}{Math.abs(it.pct).toFixed(1)}% {it.pct >= 0 ? "웃돎" : "밑돎"}</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    <span className="muted th-small">{r.est.source === "naver" ? `네이버 증권 컨센서스, 발표 전 마지막 기록(${fullDot(r.est.asOf)})` : "Finnhub 애널리스트 평균 예상"}</span>
                  </div>
                )}
                {r.lines.length > 0 && (
                  <div className="th-hist-block">
                    <span className="th-k">숫자 자세히</span>
                    <table className="th-hist-table">
                      <thead><tr><th></th><th>이번 분기</th><th>직전 분기 대비</th><th>1년 전 대비</th></tr></thead>
                      <tbody>{r.lines.map((l) => (
                        <tr key={l.label}>
                          <th>{l.label}</th><td><b>{m(l.value)}</b></td>
                          <td>{l.qoq ? <span className={l.qoq.tone}>{l.qoq.text}</span> : "-"}</td>
                          <td>{l.yoy ? <span className={l.yoy.tone}>{l.yoy.text}</span> : "-"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <div className="th-hist-nums">
                  {r.margins.map((x) => (
                    <span key={x.label}>{x.label} <b>{x.now!.toFixed(1)}%</b>{x.diff !== null && <span className={x.diff >= 0 ? "up" : "down"}> {x.diff >= 0 ? "+" : "−"}{Math.abs(x.diff).toFixed(1)}%p</span>}</span>
                  ))}
                  {r.margins.length === 0 && <span>영업이익률 <b>{r.opm === null ? "-" : `${r.opm.toFixed(1)}%`}</b></span>}
                  {r.cashRatio !== null && <span>현금 전환 <b>{r.cashRatio.toFixed(1)}배</b> <span className="muted">(영업현금흐름 ÷ 순이익)</span></span>}
                  {r.margins.some((x) => x.diff !== null) && <span className="muted th-small">%p는 1년 전 같은 분기와의 차이</span>}
                </div>
                {r.prelim.length > 0 && (
                  <p className="th-hist-note">잠정 → 확정: {r.prelim.map((x) => `${x.label} ${m(x.prelim)} → ${m(x.final)}`).join(", ")}</p>
                )}
                {r.reaction && (
                  <p className="th-hist-note">
                    발표 뒤 주가{r.reaction.when && <span className="muted"> ({r.reaction.when})</span>}: 발표 전 종가 {fullDot(r.reaction.baseDay)} 기준
                    {r.reaction.next && <> · 첫 거래일 <Pct v={r.reaction.next.pct} /></>}
                    {r.reaction.week && <> · 5거래일 뒤 <Pct v={r.reaction.week.pct} /></>}
                  </p>
                )}
                {r.ai && <p className="th-hist-ai">✨ {r.ai}</p>}
                {r.review?.doneAt && (
                  <div className="th-hist-review">
                    <span className="th-k">그때 내 점검</span>
                    {r.review.memo && <p>{r.review.memo}</p>}
                    <ul>{r.review.items.map((it) => <li key={it.thesis}>{it.title} → <b className={it.mine === "ok" || it.mine === "right" ? "th-ok" : it.mine === "bad" || it.mine === "wrong" ? "th-no" : ""}>{STATUS_WORD[it.mine]}</b></li>)}</ul>
                  </div>
                )}
                {r.links.length > 0 && (
                  <div className="th-links">{r.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
