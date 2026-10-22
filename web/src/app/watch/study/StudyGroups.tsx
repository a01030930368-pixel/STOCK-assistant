import Link from "next/link";
import { STYLES, type PeerLine } from "@/lib/study";
import StudyCompareAi from "./StudyCompareAi";

// 모아 보기(A): 업종마다 상자, 회사 한 줄에 유형·판단·싸다까지. 업종 이름을 누르면 같은 업종 비교 표(D).
export type GroupItem = {
  ticker: string; name: string; sector: string; known: boolean; styles: string[]; verdict: string; verdictKey: string;
  status: string; done: boolean; gap: number | null; ai: boolean; confidence: number; peer: PeerLine;
};
export type Group = { sector: string; items: GroupItem[] };

const href = (q: Record<string, string | undefined>) =>
  "/watch/study?" + new URLSearchParams(Object.entries({ view: "group", ...q }).filter((e): e is [string, string] => Boolean(e[1]))).toString();
const pct = (v: number | null, sign = false) => (v === null ? "-" : `${sign && v > 0 ? "+" : ""}${v}%`);
// 싸다 가격보다 아직 위면 "싸다까지 −15%", 이미 아래면 "싸다 가격 아래"
const gapText = (g: number | null, short = false) => (g === null ? "" : g >= 0 ? "싸다 가격 아래" : `${short ? "" : "싸다까지 "}${pct(g)}`);

function Verdict({ it }: { it: GroupItem }) {
  return <span className={`study-vd v-${it.verdictKey || "none"}`}>{it.verdict || (it.done ? "판단 전" : "적는 중")}</span>;
}

export function StyleChips({ on, sector }: { on: string | null; sector?: string }) {
  return (
    <div className="study-styles" aria-label="주식 유형 거르기">
      <Link href={href({ sector })} className={`chip-btn${on ? "" : " on"}`}>전체</Link>
      {STYLES.map((s) => <Link key={s} href={href({ sector, style: on === s ? undefined : s })} className={`chip-btn${on === s ? " on" : ""}`}>{s}</Link>)}
    </div>
  );
}

export default function StudyGroups({ groups, style }: { groups: Group[]; style: string | null }) {
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="study-groups-wrap">
      <StyleChips on={style} />
      {count === 0 ? <div className="panel"><p className="muted">{style ? `${style}로 적은 노트가 아직 없어요.` : "아직 노트가 없어요."}</p></div> : (
        <div className="study-groups">
          {groups.map((g) => (
            <section key={g.sector} className="panel study-group">
              <div className="study-group-head">
                <Link href={href({ sector: g.sector, style: style ?? undefined })} className="study-group-name">{g.sector} ›</Link>
                <span className="muted practice-small">{g.items.length}곳{g.items.some((i) => i.status === "보유") ? ` · 보유 ${g.items.filter((i) => i.status === "보유").length}` : ""}</span>
              </div>
              {g.items.map((it) => (
                <Link key={it.ticker} href={`/watch/study?t=${encodeURIComponent(it.ticker)}`} className="study-group-row">
                  <span className="study-group-co">{it.ai && "🎲 "}{it.name}</span>
                  <span className="study-group-tags">{it.styles.map((s) => <span key={s} className="study-tag">{s}</span>)}</span>
                  <Verdict it={it} />
                  <span className="muted study-group-gap">{gapText(it.gap)}</span>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
      <p className="muted practice-small">업종을 안 적은 노트는 증권사 업종 분류로 묶어요. 업종 이름을 누르면 같은 업종끼리 숫자로 비교해요.</p>
    </div>
  );
}

// 같은 업종 비교(D)
export function StudyCompare({ group, all, style, cached }: { group: Group; all: Group[]; style: string | null; cached: string | null }) {
  const rows = group.items;
  return (
    <div className="study-groups-wrap">
      <div className="study-styles" aria-label="업종 고르기">
        <Link href={href({ style: style ?? undefined })} className="chip-btn">‹ 업종 전체</Link>
        {all.map((g) => <Link key={g.sector} href={href({ sector: g.sector, style: style ?? undefined })} className={`chip-btn${g.sector === group.sector ? " on" : ""}`}>{g.sector} {g.items.length}</Link>)}
      </div>
      <div className="panel">
        <h3 className="study-compare-title">{group.sector} <span className="muted practice-small">공부한 {rows.length}곳 나란히</span></h3>
        <div className="study-compare-scroll">
          <table className="study-table study-compare">
            <thead><tr><th>회사</th><th className="study-compare-tags">유형</th><th>영업이익률</th><th>매출 성장</th><th>부채비율</th><th>싸다까지</th><th>확신</th><th>판단</th></tr></thead>
            <tbody>{rows.map((it) => (
              <tr key={it.ticker}>
                <td><Link href={`/watch/study?t=${encodeURIComponent(it.ticker)}`}>{it.name}</Link></td>
                <td className="study-compare-tags">{it.styles.map((s) => <span key={s} className="study-tag">{s}</span>)}</td>
                {it.peer.ready ? <><td>{pct(it.peer.margin)}</td><td className={it.peer.growth === null ? "" : it.peer.growth > 0 ? "up" : it.peer.growth < 0 ? "down" : ""}>{pct(it.peer.growth, true)}</td><td>{pct(it.peer.debt)}</td></>
                  : <td colSpan={3} className="muted">재무 받는 중</td>}
                <td className={it.gap !== null && it.gap >= 0 ? "study-ok" : ""}>{gapText(it.gap, true) || "-"}</td>
                <td className="study-compare-conf" aria-label={`확신도 ${it.confidence}`}>{"●".repeat(it.confidence)}<span>{"●".repeat(5 - it.confidence)}</span></td>
                <td><Verdict it={it} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted practice-small">이익률·성장·부채비율은 최근 연간 재무 기준이에요. 싸다까지는 노트에 적은 싸다 가격과 지금 값의 차이예요.</p>
      </div>
      {rows.length >= 2 && <StudyCompareAi sector={group.sector} tickers={rows.map((r) => r.ticker)} cached={cached} />}
    </div>
  );
}
