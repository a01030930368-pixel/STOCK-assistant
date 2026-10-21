"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { makeBrief } from "@/app/actions";
import { counts, type Cell } from "@/lib/brief";

export type Brief = {
  cells: Cell[]; one_line: string | null; good: string[] | null; bad: string[] | null;
  pending: boolean; error: string | null; made_at: Date;
};

const STALE_MS = 6 * 3600 * 1000; // 6시간 지난 요약은 열 때 새로 만들어요
const kst = (d: Date) => new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export default function BriefPanel({ ticker, name, market, brief, ai, closeHref }: {
  ticker: string; name: string; market: string; brief: Brief | null; ai: boolean; closeHref: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);
  const remake = () => start(async () => {
    const r = await makeBrief(ticker, name, market);
    setError(r.error);
    router.refresh();
  });
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (!brief || Date.now() - new Date(brief.made_at).getTime() > STALE_MS) remake();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // AI 문장을 기다리는 동안 4초마다 새로 그려요(최대 2분).
  const pending = brief?.pending ?? false;
  useEffect(() => {
    if (!pending) return;
    let n = 0;
    const id = setInterval(() => { if (++n > 30) clearInterval(id); router.refresh(); }, 4000);
    return () => clearInterval(id);
  }, [pending, router]);

  const cells = brief?.cells ?? [];
  const writing = pending && ai;
  return (
    <div className="panel brief">
      <div className="brief-head">
        <span className="label">📄 매수 전 한 장 요약</span>
        {ai && <span className="ai-tag">AI</span>}
        <Link href={closeHref} className="muted brief-close" scroll={false}>✕ 닫기</Link>
      </div>
      {!brief ? (
        <p className="muted">{error ?? "실적·수급·차트·공시를 모으는 중이에요…"}</p>
      ) : (
        <>
          {brief.one_line ? <p className="brief-one">{brief.one_line}</p>
            : writing ? <p className="brief-one muted">🤖 AI가 한 줄 결론을 쓰는 중이에요…</p> : null}
          <div className="brief-cells">
            {cells.map((c) => (
              <div key={c.key} className="brief-cell">
                <h4><i className={`sig ${c.signal}`} aria-label={{ g: "좋음", y: "보통", r: "조심", n: "자료 없음" }[c.signal]} />{c.title}</h4>
                <p>{c.text}</p>
              </div>
            ))}
          </div>
          {!pending && (brief.good?.length || brief.bad?.length) ? (
            <div className="brief-lists">
              <div className="brief-cell"><h4 className="good">👍 좋은 점</h4>{brief.good?.length ? <ul>{brief.good.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="muted">눈에 띄는 게 없어요.</p>}</div>
              <div className="brief-cell"><h4 className="bad">⚠️ 걱정되는 점</h4>{brief.bad?.length ? <ul>{brief.bad.map((b) => <li key={b}>{b}</li>)}</ul> : <p className="muted">눈에 띄는 게 없어요.</p>}</div>
            </div>
          ) : null}
          <div className="brief-foot muted">
            <span>{counts(cells)}</span>
            <span>{kst(brief.made_at)} 기준</span>
            <button type="button" className="ghost" onClick={remake} disabled={busy || pending}>{busy ? "만드는 중…" : "다시 만들기"}</button>
            {ai ? <span>숫자·색은 앱이 계산했고, 문장은 AI가 쓴 참고용이에요</span> : <span>GEMINI_API_KEY가 있으면 AI가 한 줄 결론을 써요</span>}
          </div>
          {(error || (brief.error && !pending)) && <p className="muted brief-err">{error ?? `AI가 이번엔 못 썼어요 (${brief.error}). 좋은 점·걱정되는 점은 색으로만 나눴어요.`}</p>}
        </>
      )}
    </div>
  );
}
