// 종목 페이지 재무제표와 재무 건강검진. 워커가 stock_statements에 넣은 값(국내 원, 미국 달러)으로 계산해요.

export type StatementRow = { kind: "Y" | "Q" | "C"; period: string; item: string; value: number };
export type Tab = "is" | "bs" | "cf";
export type View = "Y" | "Q";

export const ITEMS: Record<Tab, { item: string; label: string; strong?: boolean; growth?: boolean }[]> = {
  is: [
    { item: "revenue", label: "매출액", strong: true, growth: true },
    { item: "cost_of_sales", label: "매출원가" },
    { item: "gross_profit", label: "매출총이익" },
    { item: "operating_income", label: "영업이익", strong: true, growth: true },
    { item: "net_income", label: "당기순이익", strong: true },
  ],
  bs: [
    { item: "assets", label: "자산총계", strong: true },
    { item: "cash", label: "현금성자산" },
    { item: "liabilities", label: "부채총계", strong: true },
    { item: "equity", label: "자본총계", strong: true },
  ],
  cf: [
    { item: "cfo", label: "영업활동현금흐름", strong: true },
    { item: "cfi", label: "투자활동현금흐름" },
    { item: "cff", label: "재무활동현금흐름" },
    { item: "capex", label: "설비투자" },
    { item: "fcf", label: "잉여현금흐름(FCF)", strong: true },
  ],
};

export type Table = { columns: { key: string; label: string }[]; get: (col: string, item: string) => number | null };

// 표 열: 연간은 최근 3년 + 올해 누적(국내), 분기는 최근 5분기
export function tableOf(rows: StatementRow[], view: View): Table {
  const map = new Map(rows.map((r) => [`${r.kind}:${r.period}:${r.item}`, r.value]));
  const periods = (kind: string) => [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.period))].sort();
  let columns: { key: string; label: string }[];
  if (view === "Y") {
    columns = periods("Y").slice(-3).map((p) => ({ key: `Y:${p}`, label: p }));
    const c = periods("C").at(-1);
    if (c) columns.push({ key: `C:${c}`, label: `${c.slice(0, 4)}.${c.slice(5)}Q 누적` });
  } else {
    columns = periods("Q").slice(-5).map((p) => ({ key: `Q:${p}`, label: quarterLabel(p) }));
  }
  return { columns, get: (col, item) => map.get(`${col}:${item}`) ?? null };
}

export const quarterLabel = (p: string) => `${p.slice(2, 4)}.${p.slice(5)}Q`; // 2025Q3 -> 25.3Q

// 1년 전과 비교할 열: 연간은 전년, 분기는 4분기 전
export function previousKey(key: string): string | null {
  const [kind, period] = key.split(":");
  if (kind === "Y") return `Y:${Number(period) - 1}`;
  if (kind === "Q") return `Q:${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
  return null;
}

export function growth(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev <= 0) return null;
  return (cur / prev - 1) * 100;
}

export function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return (a / b) * 100;
}

export function money(v: number | null, market: string): string {
  if (v === null) return "-";
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (market === "US") {
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${Math.round(a / 1e6).toLocaleString("en-US")}M`;
    return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  }
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${sign}${Math.round(a / 1e8).toLocaleString("ko-KR")}억`;
  return `${sign}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
}

// ---------------------------------------------------------------- 재무 건강검진

export type Light = "good" | "watch" | "bad";
export type Check = { title: string; light: Light; text: string };

const pct = (v: number) => `${Math.round(v)}%`;
// 한글 끝 글자에 받침이 있으면 "이", 없으면 "가"(조가 / 억이). 영어·숫자는 "이"로 둬요.
function iga(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 === 0 ? "가" : "이";
  return "이";
}

export function healthCheck(rows: StatementRow[], market: string): Check[] {
  const t = tableOf(rows, "Y");
  const years = t.columns.filter((c) => c.key.startsWith("Y:")).map((c) => c.key);
  const last = years.at(-1);
  const prev = years.at(-2);
  const out: Check[] = [];
  if (!last) return out;
  const y = (key: string | undefined, item: string) => (key ? t.get(key, item) : null);
  const year = last.slice(2);

  const margin = ratio(y(last, "operating_income"), y(last, "revenue"));
  if (margin !== null) {
    const before = ratio(y(prev, "operating_income"), y(prev, "revenue"));
    out.push({
      title: "돈 버는 힘", light: margin >= 10 ? "good" : margin >= 0 ? "watch" : "bad",
      text: `${year}년 영업이익률 ${pct(margin)}${before === null ? "" : `, 1년 전 ${pct(before)}`}예요.${margin < 0 ? " 본업에서 손해를 보고 있어요." : ""}`,
    });
  }

  // 빚은 가장 최근 분기 말 값으로 봐요.
  const q = tableOf(rows, "Q").columns.at(-1)?.key;
  const bsKey = q && t.get(q, "equity") !== null ? q : last;
  const debt = t.get(bsKey, "liabilities");
  const equity = t.get(bsKey, "equity");
  if (debt !== null && equity !== null) {
    const when = bsKey.startsWith("Q:") ? quarterLabel(bsKey.slice(2)) : `${bsKey.slice(2)}년`;
    out.push(equity <= 0
      ? { title: "빚", light: "bad", text: `${when} 말 자본이 0 이하예요(자본잠식). 부채가 자산보다 많아요.` }
      : (() => {
        const r = (debt / equity) * 100;
        return { title: "빚", light: r < 100 ? "good" : r < 200 ? "watch" : "bad", text: `${when} 말 부채비율 ${pct(r)}예요. ${r < 100 ? "자본보다 빚이 적어 튼튼해요." : r < 200 ? "빚이 자본보다 많아요." : "빚이 자본의 2배가 넘어요."}` } as Check;
      })());
  }

  const fcf = y(last, "fcf");
  if (fcf !== null) {
    out.push({
      title: "현금", light: fcf > 0 ? "good" : "bad",
      text: fcf > 0 ? `${year}년 번 현금으로 설비투자를 하고도 ${money(fcf, market)}${iga(money(fcf, market))} 남았어요.` : `${year}년 설비투자가 번 현금보다 ${money(-fcf, market)} 많았어요.`,
    });
  }

  // 성장은 가장 최근 분기를 1년 전 같은 분기와, 없으면 연간끼리 비교해요.
  const qKey = tableOf(rows, "Q").columns.at(-1)?.key;
  const qPrev = qKey ? previousKey(qKey) : null;
  const qGrowth = qKey && qPrev ? growth(t.get(qKey, "revenue"), t.get(qPrev, "revenue")) : null;
  const yGrowth = growth(y(last, "revenue"), y(prev, "revenue"));
  const g = qGrowth ?? yGrowth;
  if (g !== null) {
    const what = qGrowth !== null && qKey ? `${quarterLabel(qKey.slice(2))} 매출이 1년 전 같은 분기보다` : `${year}년 매출이 1년 전보다`;
    out.push({ title: "성장", light: g >= 5 ? "good" : g >= -5 ? "watch" : "bad", text: `${what} ${g >= 0 ? "+" : ""}${Math.round(g)}% 변했어요.` });
  }

  const cfo = y(last, "cfo");
  const net = y(last, "net_income");
  if (cfo !== null && net !== null) {
    if (net <= 0) {
      out.push({ title: "이익의 질", light: "bad", text: `${year}년 순이익이 적자예요(${money(net, market)}).` });
    } else {
      const k = cfo / net;
      out.push({
        title: "이익의 질", light: k >= 1 ? "good" : k >= 0.5 ? "watch" : "bad",
        text: `${year}년 영업으로 들어온 현금이 순이익의 ${k.toFixed(1)}배예요. ${k >= 1 ? "이익이 실제 현금으로 들어와요." : "장부 이익에 비해 현금이 덜 들어왔어요."}`,
      });
    }
  }
  return out;
}
