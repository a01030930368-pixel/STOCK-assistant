"use client";
// 깊이 보기 › 역산 칸 아래 내 생각 한 줄(멈추면 저장)
import { useEffect, useRef, useState } from "react";
import { saveDeepNote } from "@/app/actions";

export default function DeepNote({ ticker, initial }: { ticker: string; initial: string }) {
  const [v, setV] = useState(initial);
  const [state, setState] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState("");
    const t = setTimeout(async () => { await saveDeepNote(ticker, v); setState("저장했어요"); }, 800);
    return () => clearTimeout(t);
  }, [ticker, v]);
  return (
    <label className="deep-note">
      <span>내 생각 <span className="muted">{state}</span></span>
      <input value={v} maxLength={500} placeholder="예: 사이클을 감안해도 연 6%는 넘을 것 같다 → 비싸지 않다" onChange={(e) => setV(e.target.value)} />
    </label>
  );
}
