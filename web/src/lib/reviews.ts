// 사후강평 모아 보기. 끝난 일기장(전량 매도)마다 별점과 수익률, 한 줄 교훈을 모읍니다. DB와 무관한 순수 함수입니다.

export type Reviewed = {
  key: string; name: string; end: string; returnPct: number | null; stars: number | null; followed: boolean | null; lesson: string;
};

export type StarRow = { stars: number; count: number; avgReturn: number | null };

export type ReviewSummary = {
  closed: number; reviewed: number; avgStars: number | null;
  high: { count: number; avgReturn: number | null }; // 별점 4~5
  low: { count: number; avgReturn: number | null }; // 별점 1~2
  byStars: StarRow[]; // 5점부터 1점까지
};

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);

function group(items: Reviewed[], pred: (s: number) => boolean) {
  const xs = items.filter((r) => r.stars !== null && pred(r.stars));
  return { count: xs.length, avgReturn: mean(xs.flatMap((r) => (r.returnPct === null ? [] : [r.returnPct]))) };
}

export function summarizeReviews(items: Reviewed[], closed: number): ReviewSummary {
  const starred = items.filter((r) => r.stars !== null);
  return {
    closed, reviewed: items.length,
    avgStars: starred.length ? Math.round((starred.reduce((s, r) => s + r.stars!, 0) / starred.length) * 10) / 10 : null,
    high: group(items, (s) => s >= 4),
    low: group(items, (s) => s <= 2),
    byStars: [5, 4, 3, 2, 1].map((n) => ({ stars: n, ...group(items, (s) => s === n) })),
  };
}

// 교훈 목록은 최근에 끝난 권부터. 교훈을 비워 두었으면 그 권은 빼요.
export function lessons(items: Reviewed[]): Reviewed[] {
  return items.filter((r) => r.lesson.trim()).sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
}
