"use client";

import Link from "next/link";
import { useState } from "react";

export type ListItem = { ticker: string; name: string; status: string; updated: string; done: boolean; ai: boolean; progress: string | null; verdict: string; due: boolean };

export default function StudyList({ items, on }: { items: ListItem[]; on: string | null }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.ticker.includes(q.toUpperCase()));
  const due = items.filter((i) => i.due).length;
  return (
    <div className="study-list">
      <div className="study-list-head"><b>기업 공부</b><span className="muted">{items.length}곳</span></div>
      {items.length > 4 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사 찾기" aria-label="회사 찾기" />}
      {items.length === 0 ? <p className="muted practice-small">아직 노트가 없어요. 아래에서 회사를 넣거나 🎲 AI 추천을 눌러 보세요.</p> : (
        <div className="study-items">
          {shown.map((i) => (
            <Link key={i.ticker} href={`/watch/study?t=${encodeURIComponent(i.ticker)}`} className={`study-item${i.ticker === on ? " on" : ""}`}>
              <span className="study-item-name">{i.ai && <span title="AI가 골라 준 회사">🎲 </span>}{i.name}</span>
              <span className={`study-tag s-${i.status.replace(/\s/g, "")}`}>{i.status}</span>
              <span className="muted study-item-sub">{i.due ? "🔔 다시 볼 날" : i.progress ? `적는 중 ${i.progress}` : i.verdict || "다 적음"}</span>
              <span className="muted study-item-date">{i.updated}</span>
            </Link>
          ))}
        </div>
      )}
      {due > 0 && <p className="muted practice-small">🔔 다시 볼 날이 된 노트 {due}곳</p>}
    </div>
  );
}
