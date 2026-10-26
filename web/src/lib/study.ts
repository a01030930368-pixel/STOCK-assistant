// 관심종목 › 기업 공부: 회사마다 노트 한 장. 처음엔 6단계로 따라 적고(B), 다 적으면 한 장 노트(A)에서 보고 고쳐요.
import { tableOf, type StatementRow } from "./statements";

// 눈여겨봄: 공부해 보니 괜찮아서(ㅇㅋ) 가끔 지켜보는 정도. 관심은 살지 고민하는 단계예요. 관망: 살 만한지 더 지켜보며 기다리는 중.
export const STATUSES = ["공부 중", "눈여겨봄", "관심", "관망", "보유", "보류", "탈락"] as const;
export type Status = (typeof STATUSES)[number];
export type Verdict = "buy" | "wait" | "pass" | "";
export const VERDICTS: { key: Exclude<Verdict, "">; label: string }[] = [
  { key: "buy", label: "산다" }, { key: "wait", label: "기다린다" }, { key: "pass", label: "안 산다" },
];
export const verdictLabel = (v: string | undefined) => VERDICTS.find((x) => x.key === v)?.label ?? "";
export type Power = "강함" | "보통" | "약함" | "";
export type Promise_ = { when: string; said: string; result: "kept" | "broken" | "wait" };
export const RESULTS: { key: Promise_["result"]; label: string }[] = [
  { key: "kept", label: "✓ 지킴" }, { key: "broken", label: "✗ 안 지킴" }, { key: "wait", label: "… 지켜보는 중" },
];

// 주식 유형(1~3개 고름). 워커 study.py STYLES와 같은 목록이에요.
export const STYLES = ["기술주", "성장주", "가치주", "배당주", "경기민감주", "경기방어주", "우량주", "턴어라운드", "테마주"] as const;

export type Fields = {
  sector: string; // 업종
  styles: string[]; // 주식 유형
  one: string; // ① 한 줄로 말하면
  lines: { name: string; pct: number }[]; // ② 매출 비중
  customers: string;
  power: Power;
  powerWhy: string;
  numbersNote: string; // ③ 숫자를 보고 내가 느낀 점
  moat: string; // ④ 이 회사만의 강점
  promises: Promise_[]; // ⑤
  events: { day: string; text: string }[]; // ⑥ day는 YYYY-MM-DD(모르면 빈칸)
  risks: { text: string; signal: string }[]; // ⑦
  cheap: number | null; // ⑧
  pricey: number | null;
  priceWhy: string;
  conclusion: string; // ⑨
  verdict: Verdict;
  sources: { title: string; url: string }[]; // ⑩
};

export const emptyFields = (): Fields => ({
  sector: "", styles: [], one: "", lines: [], customers: "", power: "", powerWhy: "", numbersNote: "", moat: "", promises: [], events: [],
  risks: [{ text: "", signal: "" }, { text: "", signal: "" }, { text: "", signal: "" }], cheap: null, pricey: null, priceWhy: "",
  conclusion: "", verdict: "", sources: [],
});

export type Draft = {
  sector?: string; styles?: string[];
  one?: string; lines?: { name: string; pct: number }[]; customers?: string; power?: Power; powerWhy?: string; moat?: string; numbersNote?: string;
  events?: { when: string; text: string }[]; risks?: { text: string; signal: string }[];
  promises?: { when: string; said: string }[] | string; // 예전 초안은 "찾을 곳" 한 줄(string)
  cheap?: number | null; pricey?: number | null; priceWhy?: string; conclusion?: string; sources?: { title: string; url: string }[];
  questions?: string[]; model?: string; searched?: boolean; news?: number; searchError?: string;
};
export type Pick = { why: string[]; first: string[]; flow: string; model: string | null; at: string; fresh?: boolean };

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const list = <T,>(v: unknown, n: number, f: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object").map((x) => f(x as Record<string, unknown>)).filter((x): x is T => x !== null).slice(0, n);
const price = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// DB나 화면에서 온 값을 노트 모양으로 다듬어요(빈 줄은 버리고, 길이는 잘라요). 틀릴 이유는 늘 3칸.
export function cleanFields(raw: unknown, keepBlank = false): Fields {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const risks = list(r.risks, 5, (x) => ({ text: str(x.text, 200), signal: str(x.signal, 200) }));
  const keep = <T extends Record<string, unknown>>(rows: T[], ...keys: (keyof T)[]) => (keepBlank ? rows : rows.filter((x) => keys.some((k) => x[k])));
  const filledRisks = keep(risks, "text", "signal");
  while (filledRisks.length < 3) filledRisks.push({ text: "", signal: "" });
  return {
    sector: str(r.sector, 40),
    styles: (Array.isArray(r.styles) ? r.styles : []).filter((x): x is string => (STYLES as readonly unknown[]).includes(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3),
    one: str(r.one, 300),
    lines: keep(list(r.lines, 8, (x) => ({ name: str(x.name, 40), pct: pct1(Math.max(0, Math.min(100, Number(x.pct) || 0))) })), "name"),
    customers: str(r.customers, 300),
    power: (["강함", "보통", "약함"] as const).find((p) => p === r.power) ?? "",
    powerWhy: str(r.powerWhy, 300),
    numbersNote: str(r.numbersNote, 500),
    moat: str(r.moat, 500),
    promises: keep(list(r.promises, 20, (x) => ({
      when: str(x.when, 20), said: str(x.said, 200),
      result: (["kept", "broken", "wait"] as const).find((k) => k === x.result) ?? "wait",
    })), "said"),
    events: keep(list(r.events, 12, (x) => ({ day: isDay(x.day) ? (x.day as string) : "", text: str(x.text, 200) })), "text"),
    risks: filledRisks.slice(0, Math.max(3, filledRisks.length)),
    cheap: price(r.cheap),
    pricey: price(r.pricey),
    priceWhy: str(r.priceWhy, 300),
    conclusion: str(r.conclusion, 1000),
    verdict: (["buy", "wait", "pass"] as const).find((v) => v === r.verdict) ?? "",
    sources: keep(list(r.sources, 15, (x) => ({ title: str(x.title, 100), url: /^https?:\/\//.test(str(x.url, 500)) ? str(x.url, 500) : "" })), "title", "url"),
  };
}

// 9개 질문 중 몇 개를 채웠는지. ③④는 앱이 채우지만, 내 한마디(느낀 점·강점)를 적어야 채운 걸로 봐요.
export const CHECKS: { key: string; label: string; done: (f: Fields) => boolean }[] = [
  { key: "one", label: "한 줄로 말하면", done: (f) => f.one.length >= 5 },
  { key: "model", label: "돈 버는 구조", done: (f) => f.lines.length > 0 || f.customers.length > 0 },
  { key: "numbers", label: "숫자가 뒷받침하나", done: (f) => f.numbersNote.length > 0 },
  { key: "moat", label: "경쟁사보다 나은 점", done: (f) => f.moat.length > 0 },
  { key: "promises", label: "경영진이 한 말", done: (f) => f.promises.length > 0 },
  { key: "events", label: "앞으로 일어날 일", done: (f) => f.events.length > 0 },
  { key: "risks", label: "틀릴 수 있는 이유", done: (f) => f.risks.filter((r) => r.text).length >= 2 },
  { key: "price", label: "내 가격 생각", done: (f) => f.cheap !== null || f.pricey !== null },
  { key: "conclusion", label: "결론", done: (f) => f.conclusion.length > 0 && f.verdict !== "" },
];
export const filled = (f: Fields) => CHECKS.filter((c) => c.done(f)).length;

// 처음 적을 때 따라가는 6단계(B). 각 단계가 노트의 어느 칸을 채우는지.
export const STEPS: { title: string; q: string; hint: string; parts: string[] }[] = [
  { title: "한 줄 · 돈 버는 구조", q: "이 회사는 무엇을 누구에게 팔아서 돈을 버나요?", hint: "\"이 회사는 ___을 ___에게 팔아서 돈을 번다\"를 못 쓰면 아직 모르는 회사예요. 사업보고서 '사업의 내용'이 제일 정확해요.", parts: ["one", "model"] },
  { title: "경영진이 한 말 · 앞으로 일", q: "경영진은 무엇을 약속했고, 앞으로 어떤 일이 주가를 움직일까요?", hint: "실적 발표 자료의 '내년 목표'나 인터뷰를 한 줄씩 적어 두면, 다음에 지켰는지 확인할 수 있어요.", parts: ["promises", "events"] },
  { title: "숫자가 뒷받침하나", q: "이익이 늘 때 현금도 같이 들어오나요?", hint: "이익은 느는데 현금이 안 들어오면 장부상 이익일 수 있어요. 적자 해가 있으면 이유도 적어 두세요.", parts: ["numbers"] },
  { title: "경쟁사와 비교", q: "경쟁사보다 무엇이 낫고, 그게 오래갈까요?", hint: "비교 기업을 넣으면 앱이 이익률·성장·빚을 나란히 보여 줘요. 표를 보고 이 회사만의 강점(해자)을 적어요.", parts: ["peers"] },
  { title: "틀릴 수 있는 이유 3개", q: "내 생각이 틀린다면 무엇 때문일까요?", hint: "이유마다 '이게 보이면 다시 생각한다'는 신호를 같이 적어 두면, 나중에 감정이 아니라 신호로 판단할 수 있어요.", parts: ["risks"] },
  { title: "가격 생각 · 결론", q: "얼마면 싸고, 얼마면 비싼가요? 그래서 결론은?", hint: "PER·PBR 밴드에서 지난 5년 낮은 쪽·높은 쪽을 참고해요. 결론은 5줄 안에, 판단은 산다·기다린다·안 산다 중 하나로.", parts: ["price", "conclusion", "sources"] },
];

// ③ 숫자: 연간 매출·영업이익·영업현금흐름 최근 5년, 마지막 해 영업이익률과 부채비율
export type Numbers = {
  years: string[]; revenue: (number | null)[]; op: (number | null)[]; cfo: (number | null)[];
  margin: number | null; debt: number | null; together: boolean | null;
};
export function numbersOf(rows: StatementRow[]): Numbers | null {
  const years = [...new Set(rows.filter((r) => r.kind === "Y").map((r) => r.period))].sort().slice(-5);
  if (years.length === 0) return null;
  const map = new Map(rows.filter((r) => r.kind === "Y").map((r) => [`${r.period}:${r.item}`, r.value]));
  const get = (item: string) => years.map((y) => map.get(`${y}:${item}`) ?? null);
  const revenue = get("revenue"), op = get("operating_income"), cfo = get("cfo");
  const last = years.length - 1;
  const margin = revenue[last] && op[last] !== null ? Math.round((op[last]! / revenue[last]!) * 1000) / 10 : null;
  // 빚은 가장 최근 분기 말, 없으면 마지막 해 말
  const t = tableOf(rows, "Q");
  const q = t.columns.at(-1)?.key;
  const latest = (item: string): number | null => (q ? t.get(q, item) : null) ?? map.get(`${years[last]}:${item}`) ?? null;
  const liab = latest("liabilities"), eq = latest("equity");
  const debt = liab !== null && eq ? Math.round((liab / eq) * 100) : null;
  // 이익과 현금이 같이 가나: 마지막 해 영업이익과 영업현금흐름이 둘 다 3년 전(없으면 첫 해)보다 늘었는지
  const from = Math.max(0, last - 3);
  const together = last > 0 && op[from] !== null && op[last] !== null && cfo[from] !== null && cfo[last] !== null
    ? (op[last]! > op[from]!) === (cfo[last]! > cfo[from]!) : null;
  return { years, revenue, op, cfo, margin, debt, together };
}

// 막대 높이(%): 가장 큰 절댓값을 100으로. 적자는 음수 그대로 돌려줘서 색을 바꿔 그려요.
export function bars(values: (number | null)[]): (number | null)[] {
  const max = Math.max(0, ...values.map((v) => Math.abs(v ?? 0)));
  return values.map((v) => (v === null || max === 0 ? null : Math.round((v / max) * 100)));
}

// ④ 경쟁사 표 한 줄: 최근 영업이익률, 1년 매출 성장, 부채비율
export type FinRow = { ticker: string; period: string; revenue: string | null; operating_income: string | null; liabilities: string | null; equity: string | null };
export type PeerLine = { ticker: string; name: string; margin: number | null; growth: number | null; debt: number | null; ready: boolean };
export function peerLine(ticker: string, name: string, rows: FinRow[]): PeerLine {
  // 연간 기간은 국내 "2025", 미국 "FY2025"로 들어와요.
  const year = (p: string) => p.replace(/^FY/, "");
  const mine = rows.filter((r) => r.ticker === ticker && /^(FY)?\d{4}$/.test(r.period)).sort((a, b) => year(b.period).localeCompare(year(a.period)));
  const [a, b] = mine;
  const n = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  const margin = a && n(a.revenue) ? Math.round((n(a.operating_income)! / n(a.revenue)!) * 1000) / 10 : null;
  const growth = a && b && n(a.revenue) !== null && n(b.revenue) ? Math.round(((n(a.revenue)! / n(b.revenue)!) - 1) * 1000) / 10 : null;
  const debt = a && n(a.equity) && n(a.equity)! > 0 && n(a.liabilities) !== null ? Math.round((n(a.liabilities)! / n(a.equity)!) * 100) : null;
  return { ticker, name, margin: Number.isFinite(margin) ? margin : null, growth, debt, ready: Boolean(a) };
}

// 🕰 N개월 전 나는: 지금보다 60일 넘게 앞선 버전 중 가장 최근 것, 없으면 가장 오래된 버전(오늘 만든 것 말고)
export type Version = { id: number; fields: Fields; confidence: number; price: number | null; saved_at: string };
export type PastSelf = { version: Version; days: number; months: number; change: number | null };
export function pastSelf(versions: Version[], now: Date, priceNow: number | null): PastSelf | null {
  const age = (v: Version) => Math.floor((now.getTime() - new Date(v.saved_at).getTime()) / 86400000);
  const sorted = [...versions].sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  const old = sorted.filter((v) => age(v) >= 60);
  const v = old.at(-1) ?? (sorted.length > 1 && age(sorted[0]) >= 1 ? sorted[0] : null);
  if (!v) return null;
  const days = age(v);
  return {
    version: v, days, months: Math.max(0, Math.round(days / 30)),
    change: v.price && priceNow ? Math.round((priceNow / v.price - 1) * 1000) / 10 : null,
  };
}

export const pastLabel = (p: PastSelf) => (p.months >= 1 ? `${p.months}개월 전 나는` : `${p.days}일 전 나는`);

// 다시 볼 날 기본값: 다 적은 날부터 석 달 뒤. 그달에 없는 날(11-30 → 2월)은 그달 마지막 날로.
export function reviewDefault(today: string): string {
  const [y, m, day] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 3, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 2, Math.min(day, last))).toISOString().slice(0, 10);
}

// 매출 비중은 소수점 한 자리까지 (예: 72.4%)
export const pct1 = (v: number) => Math.round(v * 10) / 10;

// 매출 비중 막대: 합이 100이 넘으면 비율대로 줄이고, 모자라면 '기타'를 붙여요.
export function splitOf(lines: { name: string; pct: number }[]): { name: string; pct: number; other?: boolean }[] {
  const sum = lines.reduce((s, l) => s + l.pct, 0);
  if (sum <= 0) return [];
  if (sum >= 100) return lines.map((l) => ({ ...l, pct: Math.round((l.pct / sum) * 1000) / 10 }));
  return [...lines, { name: "기타", pct: pct1(100 - sum), other: true }];
}

// 초안이 채울 수 있는 칸 전부(🤖 AI가 전부 채우기). 판단(산다·기다린다·안 산다)은 내가 골라요.
export const ALL_PARTS = ["kind", "one", "model", "numbers", "moat", "promises", "events", "risks", "price", "conclusion", "sources"];
export const draftPromises = (d: Draft) => (Array.isArray(d.promises) ? d.promises : []);

// AI 초안을 빈 칸에만 옮겨요(이미 적은 칸은 그대로).
export function applyDraft(f: Fields, d: Draft, parts: string[]): Fields {
  const out = { ...f };
  if (parts.includes("kind")) {
    if (!out.sector && d.sector) out.sector = d.sector;
    if (out.styles.length === 0 && d.styles?.length) out.styles = d.styles.filter((x) => (STYLES as readonly string[]).includes(x)).slice(0, 3);
  }
  if (parts.includes("one") && !out.one && d.one) out.one = d.one;
  if (parts.includes("model")) {
    if (out.lines.length === 0 && d.lines?.length) out.lines = d.lines.map((l) => ({ ...l }));
    if (!out.customers && d.customers) out.customers = d.customers;
    if (!out.power && d.power) out.power = d.power;
    if (!out.powerWhy && d.powerWhy) out.powerWhy = d.powerWhy;
  }
  if (parts.includes("numbers") && !out.numbersNote && d.numbersNote) out.numbersNote = d.numbersNote;
  if (parts.includes("moat") && !out.moat && d.moat) out.moat = d.moat;
  if (parts.includes("promises") && out.promises.length === 0 && draftPromises(d).length) out.promises = draftPromises(d).map((p) => ({ when: p.when, said: p.said, result: "wait" }));
  if (parts.includes("events") && out.events.length === 0 && d.events?.length) out.events = d.events.map((e) => ({ day: "", text: `${e.when ? `${e.when} · ` : ""}${e.text}` }));
  if (parts.includes("risks") && out.risks.every((r) => !r.text) && d.risks?.length) {
    out.risks = d.risks.map((r) => ({ ...r }));
    while (out.risks.length < 3) out.risks.push({ text: "", signal: "" });
  }
  // 가격 숫자가 둘 다 비었으면 AI 숫자를 넣어요. 이유는 이미 적었으면 그대로.
  if (parts.includes("price") && out.cheap === null && out.pricey === null && (d.cheap != null || d.pricey != null || !out.priceWhy)) {
    out.cheap = d.cheap ?? null;
    out.pricey = d.pricey ?? null;
    if (!out.priceWhy) out.priceWhy = d.priceWhy ?? "";
  }
  if (parts.includes("conclusion") && !out.conclusion && d.conclusion) out.conclusion = d.conclusion;
  if (parts.includes("sources") && out.sources.length === 0 && d.sources?.length) out.sources = d.sources.map((x) => ({ ...x }));
  return out;
}

// 모아 보기: 업종마다 묶어요. 업종을 안 적었으면 증권사 분류, 그것도 없으면 "업종 미정". 많은 업종부터.
export const NO_SECTOR = "업종 미정";
export function groupBySector<T extends { sector: string }>(items: T[]): { sector: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = it.sector.trim() || NO_SECTOR;
    map.set(key, [...(map.get(key) ?? []), it]);
  }
  return [...map.entries()].map(([sector, items]) => ({ sector, items }))
    .sort((a, b) => Number(a.sector === NO_SECTOR) - Number(b.sector === NO_SECTOR) || b.items.length - a.items.length || a.sector.localeCompare(b.sector, "ko"));
}

// 싸다 가격까지: 지금 값에서 몇 % 더 내려야(−) 싸다 가격인지. 이미 아래면 +.
export const cheapGap = (cheap: number | null, price: number | null) =>
  cheap && price ? Math.round((cheap / price - 1) * 1000) / 10 : null;
