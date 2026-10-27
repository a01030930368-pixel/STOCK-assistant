"use client";

import { useEffect, useRef, useState } from "react";
import { pollLive } from "@/app/actions";
import { ago, arrow, mine, POLL_MS, quoteOf, tone, type Holding, type LiveValue, type Quote } from "@/lib/live";

// 종목 이름 아래 가격 줄. 화면이 보이는 동안 3초마다 워커가 받은 최신 가격을 물어봐요.
export default function LivePrice({ ticker, market, initial, holding }: {
  ticker: string; market: "KR" | "US"; initial: Quote | null; holding: Holding | null;
}) {
  const [quote, setQuote] = useState<Quote | null>(initial);
  const [live, setLive] = useState<LiveValue | null>(null);
  const [flash, setFlash] = useState<"" | "up" | "down">("");
  const [now, setNow] = useState(() => Date.now());
  const last = useRef<number | null>(initial?.price ?? null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        const v = await pollLive(ticker, market).catch(() => null);
        if (stop) return;
        setLive(v);
        const q = quoteOf(v);
        if (q) {
          if (last.current !== null && q.price !== last.current) {
            setFlash(q.price > last.current ? "up" : "down");
            setTimeout(() => setFlash(""), 900);
          }
          last.current = q.price;
          setQuote(q);
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearTimeout(timer); clearInterval(clock); };
  }, [ticker, market]);

  if (!quote) return null;
  const won = market === "KR";
  const money = (v: number, sign = false) => {
    const s = sign && v > 0 ? "+" : v < 0 ? "-" : "";
    const a = Math.abs(v);
    return won ? `${s}${Math.round(a).toLocaleString("ko-KR")}원` : `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const my = mine(holding, quote.price);
  const fresh = live?.at && now - Date.parse(live.at) < 60_000;
  const state = !live?.at ? null : live.open ? (fresh ? "live" : "slow") : "closed";
  return (
    <div className="live-line">
      <span className={`live-px num${flash ? ` flash-${flash}` : ""}`}>
        {won ? Math.round(quote.price).toLocaleString("ko-KR") : `$${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        {won && <small>원</small>}
      </span>
      {quote.change !== null && (
        <span className={`live-chg num ${tone(quote.change)}`}>
          {arrow(quote.change)} {money(Math.abs(quote.change)).replace("원", "")}{quote.pct !== null && ` (${quote.pct > 0 ? "+" : ""}${quote.pct.toFixed(2)}%)`}
        </span>
      )}
      {state && (
        <span className={`live-dot ${state}`}>
          <i />{state === "live" ? `실시간 · ${ago(live!.at, now)}` : state === "slow" ? `${ago(live!.at, now)} 값` : `장 마감 · ${ago(live!.at, now)} 확인`}
        </span>
      )}
      {my && (
        <span className="muted live-mine">
          평단 {money(holding!.avg)} 대비 <span className={tone(my.pct)}>{my.pct > 0 ? "+" : ""}{my.pct.toFixed(1)}%</span>
          {" · "}평가손익 <span className={tone(my.pnl)}>{money(my.pnl, true)}</span>
        </span>
      )}
    </div>
  );
}
