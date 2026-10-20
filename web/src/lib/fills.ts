// 키움 체결(하루·종목·매수/매도 한 묶음)을 매매일지 기록 폼으로 잇는 도우미

export type KiwoomFill = {
  key: string; market: "KR" | "US"; day: string; time: string | null; ticker: string; name: string;
  side: "buy" | "sell"; quantity: number; price: number; fee: number | null; count: number;
  done: boolean; positionId: number | null;
};

// 매수는 매수 기록 폼, 매도는 그 종목의 보유 중 일지로 갑니다. 매도인데 일지가 없으면 null
export function journalHref(f: KiwoomFill): string | null {
  if (f.side === "buy") return `/journal/buy?fill=${encodeURIComponent(f.key)}`;
  return f.positionId === null ? null : `/journal/${f.positionId}?fill=${encodeURIComponent(f.key)}#sell`;
}

// 폼에 넣을 숫자: 국내는 원 단위 정수, 미국은 소수 4자리까지
export function formNumber(value: number, market: "KR" | "US"): string {
  return market === "KR" ? String(Math.round(value)) : String(Number(value.toFixed(4)));
}

export function sideLabel(side: "buy" | "sell"): string {
  return side === "buy" ? "매수" : "매도";
}
