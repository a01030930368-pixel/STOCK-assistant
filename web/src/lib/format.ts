export function won(value: string | number, digits = 0): string {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function signClass(value: string | number): string {
  const n = Number(value);
  return n > 0 ? "up" : n < 0 ? "down" : "";
}

export function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function usd(value: string | number): string {
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 퍼센트를 소수점 자리수를 고정해 보여 줍니다(예: 3 → "3.00%").
export function fixedPct(value: string | number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toFixed(digits)}%`;
}

// 출처마다 다른 날짜 모양(202609, 20261019, 2026-10-18)을 2026.09 / 2026.10.19 로 맞춥니다.
export function asOf(value: string): string {
  const d = value.replace(/-/g, "");
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
  if (/^\d{6}$/.test(d)) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return value;
}
