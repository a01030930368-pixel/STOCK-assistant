"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ChartMemo, { type Candle, type Level, type Trade } from "@/app/_components/ChartMemo";
import { savePractice } from "@/app/actions";
import { JUDGE, rescale, score, STEPS, type Decision } from "@/lib/practice";

const SPEEDS = [{ ms: 1000, label: "1×" }, { ms: 500, label: "2×" }, { ms: 200, label: "5×" }];
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");

export default function PracticeView({ game, blind, ticker, name, market, candles, start }: {
  game: string; blind: boolean; ticker: string; name: string; market: "KR" | "US"; candles: Candle[]; start: number;
}) {
  const last = Math.min(STEPS, candles.length - 1 - start); // 넘길 수 있는 봉 수
  const [step, setStep] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]); // i = 시작 봉에서 몇 번째 봉인지
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState<"no" | "saving" | "yes" | "fail">("no");

  const now = start + step;
  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const holding = useMemo(() => {
    let at: number | null = null;
    for (const d of decisions) at = d.side === "buy" ? d.i : null;
    return at;
  }, [decisions]);
  const result = useMemo(() => score(closes, start, now, decisions.map((d) => ({ ...d, i: start + d.i }))), [closes, start, now, decisions]);

  // 가린 연습은 시작 봉 종가를 100으로 맞춰 보여 줘요. 끝나면 진짜 가격·날짜로 바꿔요.
  const hide = blind && !done;
  const base = candles[start].close;
  const shown = useMemo(() => {
    const upto = candles.slice(0, (done ? start + last : now) + 1);
    return hide ? rescale(upto, base) : upto;
  }, [candles, now, done, start, last, hide, base]);
  const k = hide ? 100 / base : 1;
  const trades: Trade[] = result.trades.map((t) => ({ day: candles[t.i].day, side: t.side, price: t.price * k, quantity: 1 }));
  const levels: Level[] = holding === null ? [] : [{ kind: "avg", price: closes[start + holding] * k }];

  function decide(side: Decision["side"] | null) {
    if (done) return;
    if (side) setDecisions((ds) => [...ds, { i: step, side }]);
    if (step >= last) finish();
    else setStep((s) => s + 1);
  }
  function finish() {
    setPlaying(false);
    setDone(true);
  }
  useEffect(() => {
    if (!playing || done) return;
    if (step >= last) { finish(); return; }
    const id = setTimeout(() => setStep((s) => Math.min(last, s + 1)), SPEEDS[speed].ms);
    return () => clearTimeout(id);
  }, [playing, speed, done, last, step]);
  // 끝나면 한 번만 기록해요.
  useEffect(() => {
    if (!done || saved !== "no") return;
    setSaved("saving");
    savePractice({ game, steps: step, decisions }).then((id) => setSaved(id === null ? "fail" : "yes"), () => setSaved("fail"));
  }, [done, saved, game, step, decisions]);
  function restart() {
    setStep(0); setDecisions([]); setPlaying(false); setDone(false); setSaved("no");
  }

  const open = holding === null ? null : (closes[now] / closes[start + holding] - 1) * 100;
  return (
    <section className="practice">
      <div className="practice-bar panel">
        {!done && (
          <div className="practice-title">
            {hide ? <b>🎲 어떤 종목일까요?</b> : <b>{name} <span className="muted">{ticker}</span></b>}
            <span className="muted">{hide ? `${step}/${last}봉` : `${candles[start].day} 부터 · ${step}/${last}봉`}</span>
          </div>
        )}
        {!done ? (
          <>
            <div className="practice-acts">
              <button type="button" className="buy" disabled={holding !== null} onClick={() => decide("buy")}>산다</button>
              <button type="button" className="sell" disabled={holding === null} onClick={() => decide("sell")}>판다</button>
              <button type="button" className="soft" onClick={() => decide(null)} title="사지도 팔지도 않고 다음 봉으로">지켜본다</button>
            </div>
            <div className="practice-play">
              <button type="button" className="chip-btn" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ 멈춤" : "▶ 자동"}</button>
              <div className="segment small" role="radiogroup" aria-label="빠르기">
                {SPEEDS.map((s, n) => <button key={s.label} type="button" aria-selected={speed === n} onClick={() => setSpeed(n)}>{s.label}</button>)}
              </div>
              <button type="button" className="chip-btn" onClick={restart} title="처음부터">⏮</button>
              <button type="button" className="ghost" onClick={finish}>여기서 끝내기</button>
            </div>
            <div className="practice-score">
              <span>내 수익 <b className={tone(result.returnPct)}>{pct(result.returnPct)}</b></span>
              {open !== null && <span>지금 들고 있는 것 <b className={tone(open)}>{pct(open)}</b></span>}
              <span className="muted">매매 {result.trades.length}번</span>
            </div>
          </>
        ) : (
          <div className="practice-reveal">
            <p className="practice-name">{blind && "정답: "}<b>{name}</b> <span className="muted">{ticker} · {candles[start].day} ~ {candles[now].day}</span></p>
            <div className="practice-score">
              <span>내 수익 <b className={tone(result.returnPct)}>{pct(result.returnPct)}</b></span>
              <span>그냥 들고 있었으면 <b className={tone(result.holdPct)}>{pct(result.holdPct)}</b></span>
              <span>맞힘 <b>{result.hits}/{result.calls}</b> <span className="muted">(산 뒤 {JUDGE}봉 뒤 올랐거나, 판 뒤 {JUDGE}봉 뒤 내렸으면 맞힘)</span></span>
            </div>
            <p className="muted">
              {result.trades.length === 0 ? "한 번도 사고팔지 않았어요."
                : result.returnPct > result.holdPct ? "그냥 들고 있기보다 잘했어요." : result.returnPct === result.holdPct ? "그냥 들고 있기와 같았어요." : "이번엔 그냥 들고 있는 게 나았어요."}
              {saved === "yes" ? " 기록을 남겼어요." : saved === "fail" ? " 기록을 남기지 못했어요." : ""}
            </p>
            {result.trades.length > 0 && (
              <ul className="practice-trades">
                {result.trades.map((t) => (
                  <li key={t.i}><span className={t.side === "buy" ? "up" : "down"}>{t.side === "buy" ? "산 날" : "판 날"}</span> {candles[t.i].day} · {market === "US" ? `$${t.price.toFixed(2)}` : Math.round(t.price).toLocaleString("ko-KR")}</li>
                ))}
              </ul>
            )}
            <div className="practice-acts">
              <Link className="button" href="/watch/practice?dice=1">🎲 다음 종목</Link>
              <button type="button" className="soft" onClick={restart}>같은 차트 다시</button>
              <Link className="button soft" href={`/stock/${encodeURIComponent(ticker)}`}>종목 화면</Link>
            </div>
          </div>
        )}
      </div>
      <ChartMemo key={hide ? "blind" : "open"} ticker={ticker} name={name} market={market} candles={shown} minutes={[]} memos={[]} trades={trades} levels={levels}
        today={shown[shown.length - 1].day} current={null} marks={[]} doodles={[]} practice={{ blind: hide }} />
    </section>
  );
}
