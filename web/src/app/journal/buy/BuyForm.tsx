"use client";

import { useActionState } from "react";
import { createBuy, type FormState } from "@/app/actions";

type Props = {
  ticker: string; name: string; market: string; today: string; quantity?: string; price?: string; fillKey?: string;
  bookKey?: string; entryId?: number; initial?: Record<string, string>; // 일기장에서 열었거나 예전 일지를 고칠 때
};

export default function BuyForm({ ticker, name, market, today, quantity = "", price = "", fillKey = "", bookKey = "", entryId, initial = {} }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createBuy, { errors: [] });
  const v = (key: string, fallback = "") => state.values?.[key] ?? initial[key] ?? fallback;
  const fixed = Boolean(bookKey || entryId); // 일기장·고치기에서는 종목을 바꾸지 않아요

  return (
    <form action={action} className="stack">
      {fillKey && <input type="hidden" name="fillKey" value={fillKey} />}
      {bookKey && <input type="hidden" name="bookKey" value={bookKey} />}
      {entryId && <input type="hidden" name="entryId" value={entryId} />}
      {state.errors.length > 0 && (
        <div className="card errors">
          {state.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      <div className="row">
        <label>매수일<input type="date" name="tradeDate" defaultValue={v("tradeDate", today)} required /></label>
        {fixed ? (
          <>
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="ticker" value={ticker} />
            <input type="hidden" name="market" value={market} />
          </>
        ) : (
          <>
            <label>종목명<input name="name" defaultValue={v("name", name)} required /></label>
            <label>티커<input name="ticker" defaultValue={v("ticker", ticker)} required /></label>
            <label>시장
              <select name="market" defaultValue={v("market", market || "KR")}>
                <option value="KR">국내</option>
                <option value="US">미국</option>
              </select>
            </label>
          </>
        )}
      </div>
      <div className="row">
        <label>수량<input name="quantity" defaultValue={v("quantity", quantity)} inputMode="decimal" required /></label>
        <label>매수가<input name="price" defaultValue={v("price", price)} inputMode="decimal" required /></label>
      </div>

      <fieldset className="checklist">
        <legend>매수 전 체크리스트</legend>
        <label>1. 왜 사는가? (한 문장)<input name="reason" defaultValue={v("reason")} required /></label>
        <label>2. 이 종목의 가장 큰 리스크 3가지는?
          <input name="risk1" defaultValue={v("risk1")} placeholder="리스크 1" required />
          <input name="risk2" defaultValue={v("risk2")} placeholder="리스크 2" required />
          <input name="risk3" defaultValue={v("risk3")} placeholder="리스크 3" required />
        </label>
        <label>3. 비중은 자산의 몇 %?<input name="weightPct" defaultValue={v("weightPct")} inputMode="decimal" required /></label>
        <label>4. 손절 라인은 얼마?<input name="stopPrice" defaultValue={v("stopPrice")} inputMode="decimal" required /></label>
        <div className="row">
          <label>5. 익절 목표가는 얼마?<input name="targetPrice" defaultValue={v("targetPrice")} inputMode="decimal" required /></label>
          <label>목표가 근거
            <select name="targetBasis" defaultValue={v("targetBasis", "chart")}>
              <option value="chart">차트 분석</option>
              <option value="percent">퍼센트</option>
            </select>
          </label>
        </div>
      </fieldset>

      <label>기대 시나리오<textarea name="scenario" defaultValue={v("scenario")} /></label>
      <p className="muted">저장하면 손절·익절가에 도달할 때 텔레그램 알림이 자동으로 설정됩니다. 이미 다 판 종목은 알림을 만들지 않아요.</p>
      <button type="submit" disabled={pending}>{pending ? "저장 중" : entryId ? "고친 내용 저장" : "매수 기록 저장"}</button>
    </form>
  );
}
