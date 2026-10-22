"use client";

import { useEffect, useState } from "react";
import { readStudyCompare, requestStudyCompare } from "@/app/actions";

const WAIT_MS = 2000, GIVE_UP = 45;

export default function StudyCompareAi({ sector, tickers, cached }: { sector: string; tickers: string[]; cached: string | null }) {
  const [text, setText] = useState(cached);
  const [id, setId] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (tries >= GIVE_UP) { setId(null); setError("워커가 답이 없어요. 워커가 켜져 있는지 확인해 주세요."); return; }
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
      {error && <p className="practice-warn practice-small">{error}</p>}
    </div>
  );
}
