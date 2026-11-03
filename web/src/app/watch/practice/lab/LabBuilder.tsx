"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askLabParse, readLabParse, saveLabRule } from "@/app/actions";
import { BUY_HINT, BUY_KEYS, BUY_LABEL, cleanRule, DEFAULT_RULE, MARKETS, YEARS, type Market, type Rule } from "@/lib/lab";

type SellNum = "stop" | "target" | "days";
const SELL_NUM: { key: SellNum; label: (v: string) => string; unit: string; fallback: number }[] = [
  { key: "stop", label: (v) => `손절 −${v}%`, unit: "%", fallback: 7 },
  { key: "target", label: (v) => `익절 +${v}%`, unit: "%", fallback: 15 },
  { key: "days", label: (v) => `${v}일 뒤`, unit: "일", fallback: 20 },
];

export default function LabBuilder({ id, name, rule, counts }: { id: number | null; name: string; rule: Rule | null; counts: { KR: number; US: number } }) {
  const router = useRouter();
  const start = rule ?? DEFAULT_RULE;
  const [buy, setBuy] = useState(start.buy);
  const [on, setOn] = useState({ stop: start.sell.stop !== null, target: start.sell.target !== null, days: start.sell.days !== null });
  const [nums, setNums] = useState({ stop: String(start.sell.stop ?? 7), target: String(start.sell.target ?? 15), days: String(start.sell.days ?? 20) });
  const [ma20break, setBreak] = useState(start.sell.ma20break);
  const [market, setMarket] = useState<Market>(start.market);
  const [years, setYears] = useState(start.years);
  const [title, setTitle] = useState(name);
  const [line, setLine] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, go] = useTransition();

  const current = () => cleanRule({
    buy, market, years,
    sell: { stop: on.stop ? nums.stop : null, target: on.target ? nums.target : null, days: on.days ? nums.days : null, ma20break },
  });
  const count = market === "ALL" ? counts.KR + counts.US : counts[market];

  const apply = (r: Rule) => {
    setBuy(r.buy);
    setOn({ stop: r.sell.stop !== null, target: r.sell.target !== null, days: r.sell.days !== null });
    setNums((n) => ({ stop: String(r.sell.stop ?? n.stop), target: String(r.sell.target ?? n.target), days: String(r.sell.days ?? n.days) }));
    setBreak(r.sell.ma20break);
    setMarket(r.market);
    setYears(r.years);
  };

  const fill = async () => {
    if (!line.trim()) return;
    setAsking(true);
    setAiNote(null);
    const ask = await askLabParse(line).catch(() => null);
    if (!ask) { setAsking(false); setAiNote("부탁을 못 보냈어요. 잠시 뒤 다시 눌러 주세요."); return; }
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await readLabParse(ask).catch(() => null);
      if (!res || res.status === "pending") continue;
      setAsking(false);
      if (res.status === "error") { setAiNote(`AI가 못 바꿨어요: ${res.error ?? ""}`); return; }
      apply(cleanRule(res.rule ?? res.partial).rule);
      if (res.name && !title) setTitle(res.name);
      const left = res.unsupported ?? [];
      setAiNote(left.length ? `칸을 채웠어요. 아직 못 해요: ${left.join(" · ")}` : "칸을 채웠어요. 맞는지 보고 돌려 보세요.");
      return;
    }
    setAsking(false);
    setAiNote("AI 답이 늦어요. 워커가 켜져 있는지 확인하고 다시 눌러 주세요.");
  };

  const save = (asNew: boolean) => {
    const { rule: r, errors } = current();
    if (errors.length) { setMsg(errors.join(" ")); return; }
    setMsg(null);
    go(async () => {
      const res = await saveLabRule({ id: asNew ? null : id, name: title, rule: r });
      if (res.error) setMsg(res.error);
      else router.push(`/watch/practice/lab?r=${res.id}`);
    });
  };

  return (
    <section className="panel lab-builder">
      <div className="lab-builder-head">
        <h2>🧪 {id ? "규칙 고치기" : "규칙 만들기"}</h2>
        <input className="lab-name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="규칙 이름 (예: 눌림목 RSI)" maxLength={30} aria-label="규칙 이름" />
      </div>
      <div className="lab-line">
        <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="한 줄로: 20일선 위에서 RSI 30 아래로 떨어지면 사고, −7%나 +15%면 판다" maxLength={400} aria-label="규칙을 한 줄로" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fill(); } }} />
        <button type="button" className="lab-ai" onClick={fill} disabled={asking || !line.trim()}>{asking ? "채우는 중…" : "✨ 칸 채우기"}</button>
      </div>
      {aiNote && <p className="muted lab-small">{aiNote}</p>}

      <h3 className="lab-h3">살 때 <span className="muted">모두 맞으면</span></h3>
      <div className="lab-conds">
        {BUY_KEYS.map((k) => (
          <button key={k} type="button" className={buy[k] ? "lab-cond on" : "lab-cond"} aria-pressed={buy[k]} title={BUY_HINT[k]} onClick={() => setBuy({ ...buy, [k]: !buy[k] })}>
            {buy[k] ? "✓ " : "＋ "}{BUY_LABEL[k]}
          </button>
        ))}
      </div>
      <h3 className="lab-h3">팔 때 <span className="muted">먼저 오는 것</span></h3>
      <div className="lab-conds">
        {SELL_NUM.map((s) => (
          <span key={s.key} className={on[s.key] ? "lab-cond on" : "lab-cond"}>
            <button type="button" className="lab-cond-toggle" aria-pressed={on[s.key]} onClick={() => setOn({ ...on, [s.key]: !on[s.key] })}>{on[s.key] ? "✓" : "＋"}</button>
            {s.key === "stop" ? "손절 −" : s.key === "target" ? "익절 +" : ""}
            <input type="number" inputMode="decimal" min={s.key === "days" ? 1 : 0.5} step={s.key === "days" ? 1 : 0.5} value={nums[s.key]}
              onChange={(e) => { setNums({ ...nums, [s.key]: e.target.value }); setOn({ ...on, [s.key]: true }); }} aria-label={s.label(nums[s.key])} />
            {s.unit}{s.key === "days" ? " 뒤" : ""}
          </span>
        ))}
        <button type="button" className={ma20break ? "lab-cond on" : "lab-cond"} aria-pressed={ma20break} onClick={() => setBreak(!ma20break)}>{ma20break ? "✓ " : "＋ "}20일선 이탈</button>
      </div>

      <div className="lab-opts">
        <span className="muted lab-small">종목</span>
        <div className="segment" role="tablist" aria-label="종목">
          {MARKETS.map((m) => <button key={m.key} type="button" role="tab" aria-selected={market === m.key} onClick={() => setMarket(m.key)}>{m.label}</button>)}
        </div>
        <span className="muted lab-small">기간</span>
        <div className="segment" role="tablist" aria-label="기간">
          {YEARS.map((y) => <button key={y} type="button" role="tab" aria-selected={years === y} onClick={() => setYears(y)}>{y}년</button>)}
        </div>
      </div>
      {msg && <p className="practice-warn">{msg}</p>}
      <div className="lab-run">
        <button type="button" onClick={() => save(false)} disabled={pending}>{pending ? "보내는 중…" : `${count.toLocaleString()}종목에서 ${id ? "다시 " : ""}돌려 보기`}</button>
        {id && <button type="button" className="lab-secondary" onClick={() => save(true)} disabled={pending}>새 규칙으로 저장</button>}
        <span className="muted lab-small">1~2분 걸려요</span>
      </div>
    </section>
  );
}
