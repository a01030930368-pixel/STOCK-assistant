"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readStudyPick, requestStudyPick } from "@/app/actions";

const MARKETS = [{ key: "ALL", label: "아무거나" }, { key: "KR", label: "국내" }, { key: "US", label: "미국" }];
// 2초마다 최대 6분. 워커는 기업 공부 일을 한 줄로 해서, AI가 다른 노트 초안을 쓰는 중이면 몇 분 기다려요.
const WAIT_MS = 2000, SLOW = 15, GIVE_UP = 180;

export default function StudyDice() {
  const router = useRouter();
  const [market, setMarket] = useState("ALL");
  const [fresh, setFresh] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (tries >= GIVE_UP) { setId(null); setError("AI가 다른 노트를 쓰느라 오래 걸려요. 조금 뒤 다시 눌러 주세요. 계속 이러면 워커가 켜져 있는지 봐 주세요."); return; }
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
      {id && tries >= SLOW && <p className="muted practice-small">AI가 다른 노트를 쓰는 중이라 조금 걸려요. 그대로 두시면 이어서 해요.</p>}
      {error && <p className="practice-warn practice-small">{error}</p>}
    </div>
  );
}
