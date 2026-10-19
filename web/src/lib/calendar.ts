// 달력 화면 계산. 날짜는 시간대 문제를 피하려고 "YYYY-MM-DD" 글자로만 다룹니다.

export type Month = { year: number; month: number }; // month: 1~12

export function monthOf(raw: string | undefined, today: string): Month {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) };
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

export function shift({ year, month }: Month, by: number): Month {
  const i = year * 12 + (month - 1) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

export const ym = ({ year, month }: Month) => `${year}-${String(month).padStart(2, "0")}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// 일요일부터 시작하는 주 단위 칸. 이번 달이 아닌 날은 null.
export function monthGrid({ year, month }: Month): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(iso(new Date(Date.UTC(year, month - 1, d))));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
