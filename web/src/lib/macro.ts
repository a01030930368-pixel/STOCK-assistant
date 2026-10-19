export type MacroInput = {
  snapshotDate: string;
  krBaseRate: number | null;
  usBaseRate: number | null;
  usdkrw: number | null;
  gdpOutlook: string;
  inflation: number | null;
  usInflation: number | null;
  keyVariables: string;
  implications: string;
};

// 빈칸은 null, 숫자가 아니면 NaN을 돌려줘 검증에서 걸러냅니다.
export function optionalNumber(raw: string): number | null {
  const text = raw.replace(/,/g, "").replace(/%$/, "").trim();
  return text === "" ? null : Number(text);
}

export function validateMacro(input: MacroInput): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.snapshotDate)) errors.push("기록 날짜를 입력하세요.");
  const numbers: [string, number | null][] = [
    ["한국 기준금리", input.krBaseRate], ["미국 기준금리", input.usBaseRate], ["원/달러 환율", input.usdkrw],
    ["한국 물가 상승률", input.inflation], ["미국 물가 상승률", input.usInflation],
  ];
  for (const [label, value] of numbers) {
    if (value !== null && !Number.isFinite(value)) errors.push(`${label}은 숫자로 입력하세요.`);
  }
  if (input.implications.trim() === "") errors.push("시사점을 한 줄이라도 적어 주세요.");
  return errors;
}

// 한미 금리차(한국 - 미국, %p). 둘 중 하나라도 없으면 null.
export function rateGap(kr: number | string | null, us: number | string | null): number | null {
  if (kr === null || us === null) return null;
  return Math.round((Number(kr) - Number(us)) * 100) / 100;
}
