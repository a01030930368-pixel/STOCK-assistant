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
