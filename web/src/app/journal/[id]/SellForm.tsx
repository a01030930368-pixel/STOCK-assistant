"use client";

import { useActionState } from "react";
import { createSell, type FormState } from "@/app/actions";

type Props = {
  positionId?: number; remaining?: number; today: string; quantity?: string; price?: string; fillKey?: string;
  bookKey?: string; entryId?: number; initial?: Record<string, string>; // 일기장에서 열었거나 예전 일지를 고칠 때
};

export default function SellForm({ positionId, remaining, today, quantity, price = "", fillKey = "", bookKey = "", entryId, initial = {} }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSell, { errors: [] });
  const v = (key: string, fallback = "") => state.values?.[key] ?? initial[key] ?? fallback;

  return (
    <form action={action} className="stack">
      {positionId !== undefined && <input type="hidden" name="positionId" value={positionId} />}
      {fillKey && <input type="hidden" name="fillKey" value={fillKey} />}
      {bookKey && <input type="hidden" name="bookKey" value={bookKey} />}
      {entryId && <input type="hidden" name="entryId" value={entryId} />}
      {state.errors.length > 0 && (
        <div className="card errors">
          {state.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      <div className="row">
        <label>매도일<input type="date" name="tradeDate" defaultValue={v("tradeDate", today)} required /></label>
        <label>수량{remaining !== undefined && ` (남은 ${remaining})`}<input name="quantity" inputMode="decimal" defaultValue={v("quantity", quantity ?? String(remaining ?? ""))} required /></label>
        <label>매도가<input name="price" defaultValue={v("price", price)} inputMode="decimal" required /></label>
      </div>
      <div className="row">
        <label>매도 이유
          <select name="reasonType" defaultValue={v("reasonType")}>
            <option value="" disabled>고르세요</option>
            <option value="stop">손절</option>
            <option value="target">익절</option>
            <option value="other">다른 사유</option>
          </select>
        </label>
        <label>원래 세운 원칙을 지켰는가?
          <select name="followedRules" defaultValue={v("followedRules")}>
            <option value="" disabled>고르세요</option>
            <option value="yes">지켰다</option>
            <option value="no">못 지켰다</option>
          </select>
        </label>
      </div>
      <label>이유 상세<input name="reasonDetail" defaultValue={v("reasonDetail")} /></label>
      <label>배운 것 (다음에 비슷한 상황에서 무엇을 다르게 할 것인가)<textarea name="lesson" defaultValue={v("lesson")} required /></label>
      <p className="muted">{bookKey ? "수익률과 보유 기간은 이 일기장의 키움 체결로 자동 계산됩니다." : "수익률과 보유 기간은 매수 기록에서 자동 계산됩니다."}</p>
      <button type="submit" disabled={pending}>{pending ? "저장 중" : entryId ? "고친 내용 저장" : "매도 기록 저장"}</button>
    </form>
  );
}
