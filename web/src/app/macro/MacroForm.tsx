"use client";

import { useActionState } from "react";
import { saveMacro, type FormState } from "@/app/actions";

export default function MacroForm({ defaults }: { defaults: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMacro, { errors: [] });
  const v = (key: string) => state.values?.[key] ?? defaults[key] ?? "";

  return (
    <form action={action} className="stack">
      {state.errors.length > 0 && (
        <div className="card errors">
          {state.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      <label>기록 날짜<input type="date" name="snapshotDate" defaultValue={v("snapshotDate")} required /></label>
      <div className="row">
        <label>한국 기준금리 (%)<input name="krBaseRate" defaultValue={v("krBaseRate")} inputMode="decimal" /></label>
        <label>미국 기준금리 (%)<input name="usBaseRate" defaultValue={v("usBaseRate")} inputMode="decimal" /></label>
        <label>원/달러 환율<input name="usdkrw" defaultValue={v("usdkrw")} inputMode="decimal" /></label>
      </div>
      <div className="row">
        <label>한국 물가 상승률 (%)<input name="inflation" defaultValue={v("inflation")} inputMode="decimal" /></label>
        <label>미국 물가 상승률 (%)<input name="usInflation" defaultValue={v("usInflation")} inputMode="decimal" /></label>
      </div>
      <label>GDP 성장률 전망<input name="gdpOutlook" defaultValue={v("gdpOutlook")} placeholder="예: 한은 2026년 1.8% 전망" /></label>
      <label>주요 변수<textarea name="keyVariables" defaultValue={v("keyVariables")} placeholder="예: 미국 대선, 유가, 반도체 수출" /></label>
      <label>시사점<textarea name="implications" defaultValue={v("implications")} placeholder="지금 환경이 내 투자에 주는 의미" required /></label>
      <button type="submit" disabled={pending}>{pending ? "저장 중…" : "매크로 메모 저장"}</button>
    </form>
  );
}
