// 워커(worker/app/disclosures.py)가 나눈 공시 종류. 화면 배지와 한 줄 풀이에 씁니다.
export const KIND: Record<string, { label: string; tone: "warn" | "gold" | ""; explain: string }> = {
  halt: { label: "거래 주의", tone: "warn", explain: "거래가 멈추거나 상장 유지에 문제가 생길 수 있는 공시예요." },
  rights: { label: "유상증자", tone: "warn", explain: "회사가 새 주식을 팔아 돈을 모아요. 주식 수가 늘어 주가가 흔들릴 수 있어요." },
  cb: { label: "사채", tone: "warn", explain: "나중에 주식으로 바뀔 수 있는 빚이에요. 바뀌면 주식 수가 늘어요." },
  reduce: { label: "감자", tone: "warn", explain: "주식 수를 줄여요. 왜 줄이는지 공시에서 꼭 확인해 보세요." },
  bonus: { label: "무상증자", tone: "gold", explain: "주주에게 새 주식을 공짜로 나눠 줘요. 그만큼 주가는 낮게 조정돼요." },
  merge: { label: "합병·분할", tone: "gold", explain: "회사를 합치거나 나눠요. 주식이 바뀌는 조건을 확인해 보세요." },
  earnings: { label: "실적", tone: "gold", explain: "실적이 나왔어요. 1년 전과 비교한 숫자가 공시에 있어요." },
  contract: { label: "계약", tone: "gold", explain: "큰 계약을 맺었어요. 계약 금액과 기간은 공시에서 볼 수 있어요." },
  owner: { label: "최대주주", tone: "warn", explain: "회사의 주인이 바뀌어요." },
  buyback: { label: "자사주", tone: "gold", explain: "회사가 자기 주식을 사거나 팔거나 없애요." },
  dividend: { label: "배당", tone: "gold", explain: "배당을 정했어요. 금액과 기준일은 공시에서 볼 수 있어요." },
  lawsuit: { label: "소송", tone: "warn", explain: "회사가 소송을 당했거나 걸었어요." },
  inquiry: { label: "조회공시", tone: "warn", explain: "주가가 크게 움직여 거래소가 이유를 물었거나 회사가 답했어요." },
  stake: { label: "지분", tone: "", explain: "" },
  other: { label: "기타", tone: "", explain: "" },
};

export const kindOf = (key: string) => KIND[key] ?? KIND.other;
export const dartUrl = (rceptNo: string) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`;
