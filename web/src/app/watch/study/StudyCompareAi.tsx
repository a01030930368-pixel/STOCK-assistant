"use client";

import { useEffect, useState } from "react";
import { readStudyCompare, requestStudyCompare } from "@/app/actions";

// 2초마다 최대 6분. 워커는 기업 공부 일을 한 줄로 해서, AI가 다른 노트 초안을 쓰는 중이면 몇 분 기다려요.
const WAIT_MS = 2000, SLOW = 15, GIVE_UP = 180;

export default function StudyCompareAi({ sector, tickers, cached }: { sector: string; tickers: string[]; cached: string | null }) {
  const [text, setText] = useState(cached);
  const [id, setId] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (tries >= GIVE_UP) { setId(null); setError("AI가 다른 노트를 쓰느라 오래 걸려요. 조금 뒤 다시 눌러 주세요. 계속 이러면 워커가 켜져 있는지 봐 주세요."); return; }
    const timer = setTimeout(async () => {
      const r = await readStudyCompare(id).catch(() => null);
      if (r?.status === "done" && r.text) { setId(null); setText(r.text); }
      else if (r?.status === "error") { setId(null); setError(r.error ?? "비교를 못 받았어요."); }
      else setTries((n) => n + 1);
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [id, tries]);

  async function ask() {
    setError(null);
    setTries(0);
    setId(await requestStudyCompare(sector, tickers));
  }

  return (
    <div className="study-draft">
      <div className="study-draft-head">
        <b>✨ AI 한 줄 비교 (참고용)</b>
        <button type="button" className="chip-btn" onClick={ask} disabled={id !== null}>{id ? "AI가 비교하는 중…" : text ? "다시 받기" : "비교 받기"}</button>
      </div>
      {text && <p className="study-text">{text}</p>}
      {id && tries >= SLOW && <p className="muted practice-small">AI가 다른 노트를 쓰는 중이라 조금 걸려요. 그대로 두시면 이어서 해요.</p>}
      {error && <p className="practice-warn practice-small">{error}</p>}
    </div>
  );
}
