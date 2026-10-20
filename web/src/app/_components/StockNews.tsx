"use client";
import { useState } from "react";

export type StockNewsItem = { url: string; title: string; titleKo: string | null; summary: string; summaryKo: string | null; meta: string };

const HANGUL = /[가-힣]/;
// 구글 번역 페이지로 기사 전체를 한국어로 엽니다.
const translatedPage = (url: string) => `https://translate.google.com/translate?sl=auto&tl=ko&u=${encodeURIComponent(url)}`;

// 미국 종목 뉴스는 한국어 제목·요약을 먼저 보여 주고, 누르면 번역된 기사로 엽니다.
export default function StockNews({ items, us }: { items: StockNewsItem[]; us: boolean }) {
  const [korean, setKorean] = useState(true);
  const english = us && items.some((n) => !HANGUL.test(n.title));
  return (
    <>
      <h2>
        뉴스
        {english && (
          <button type="button" className="link-toggle" onClick={() => setKorean(!korean)}>
            {korean ? "원문 보기" : "한국어로 보기"}
          </button>
        )}
      </h2>
      {items.map((n) => {
        const ko = english && korean && !HANGUL.test(n.title);
        const summary = ko ? n.summaryKo ?? n.summary : n.summary;
        return (
          <div key={n.url} className="card">
            <a href={ko ? translatedPage(n.url) : n.url} target="_blank" rel="noreferrer">{ko ? n.titleKo ?? n.title : n.title}</a>
            <div className="muted">{n.meta}</div>
            {summary && <div className="muted">{summary}</div>}
          </div>
        );
      })}
    </>
  );
}
