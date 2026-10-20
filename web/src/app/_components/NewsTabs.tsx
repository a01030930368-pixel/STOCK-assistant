"use client";
import { useState } from "react";

export type NewsItem = { key: string; market: "KR" | "US"; ticker: string; title: string; titleKo: string | null; url: string; meta: string };

// 구글 번역 페이지로 기사 전체를 한국어로 엽니다.
const translatedPage = (url: string) => `https://translate.google.com/translate?sl=auto&tl=ko&u=${encodeURIComponent(url)}`;

export default function NewsTabs({ items, initial }: { items: NewsItem[]; initial: "KR" | "US" }) {
  const [tab, setTab] = useState(initial);
  const [korean, setKorean] = useState(true);
  const shown = items.filter((n) => n.market === tab);
  return (
    <>
      <div className="panel-title">
        최신 뉴스
        {tab === "US" && (
          <button type="button" className="link-toggle" onClick={() => setKorean(!korean)}>
            {korean ? "원문 보기" : "한국어로 보기"}
          </button>
        )}
      </div>
      <div className="segment small" role="tablist">
        {(["KR", "US"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={tab === m} onClick={() => setTab(m)}>
            {m === "KR" ? "국내" : "해외"}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="muted">{tab === "KR" ? "국내" : "해외"} 보유 종목 뉴스가 아직 없습니다.</div>
      ) : (
        <ul className="feed">
          {shown.map((n) => {
            // 국내 언론의 미국 종목 기사는 이미 한국어라 번역 없이 엽니다.
            const ko = tab === "US" && korean && !/[가-힣]/.test(n.title);
            return (
              <li key={n.key}>
                <a href={ko ? translatedPage(n.url) : n.url} target="_blank" rel="noopener noreferrer">
                  {ko && n.titleKo ? n.titleKo : n.title}
                </a>
                <div className="meta">{n.ticker} · {n.meta}</div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
