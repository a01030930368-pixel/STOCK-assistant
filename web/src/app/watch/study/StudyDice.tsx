"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readStudyPick, requestStudyPick } from "@/app/actions";

const MARKETS = [{ key: "ALL", label: "아무거나" }, { key: "KR", label: "국내" }, { key: "US", label: "미국" }];
const WAIT_MS = 2000, GIVE_UP = 45; // 2초마다 최대 90초

export default function StudyDice() {
  const router = useRouter();
  const [market, setMarket] = useState("ALL");
  const [fresh, setFresh] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (tries >= GIVE_UP) { setId(null); setError("워커가 답이 없어요. 워커가 켜져 있는지 확인해 주세요."); return; }
    const timer = setTimeout(async () => {
      const r = await readStudyPick(id).catch(() => null);
      if (r?.status === "done" && r.ticker) { setId(null); router.push(`/watch/study?t=${encodeURIComponent(r.ticker)}`); router.refresh(); }
      else if (r?.status === "error") { setId(null); setError(r.error ?? "고르지 못했어요."); }
      else setTries((n) => n + 1);
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [id, tries, router]);

  async function roll() {
    setError(null);
    setTries(0);
    setId(await requestStudyPick(market, fresh));
  }

  return (
    <div className="panel study-dice">
      <b>🎲 AI 추천 공부</b>
      <p className="muted practice-small">요즘 흐름이 좋은 큰 종목 중 무작위로 몇 개를 뽑아, AI가 공부할 회사 하나를 골라 줘요. 사라는 뜻은 아니에요.</p>
      <div className="segment study-seg" role="radiogroup" aria-label="시장">
        {MARKETS.map((m) => <button key={m.key} type="button" aria-selected={market === m.key} onClick={() => setMarket(m.key)}>{m.label}</button>)}
      </div>
      <label className="study-fresh">
        <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
        <span>🧭 안 해 본 업종·유형에서 고르기<small className="muted">지금까지 공부한 업종은 빼고 골라요</small></span>
      </label>
      <button type="button" onClick={roll} disabled={id !== null}>{id ? "AI가 고르는 중…" : "🎲 공부할 회사 골라 줘"}</button>
      {error && <p className="practice-warn practice-small">{error}</p>}
    </div>
  );
}
