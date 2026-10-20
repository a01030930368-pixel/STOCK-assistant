// 종목 일기장: 한 종목을 처음 산 날부터 전부 판 날까지가 한 권입니다. 다 판 뒤 다시 사면 새 권이 시작돼요.
// 키움 체결(하루·종목·매수/매도 한 묶음)과 체결 없이 손으로 적은 일지를 날짜순으로 쌓아 보유 수량을 따라갑니다.
// DB와 무관한 순수 함수입니다.

export type Market = "KR" | "US";
export type Side = "buy" | "sell";

export type BookEvent = {
  id: string; // 체결이면 fill_key, 손으로만 적은 일지면 buy:ID / sell:ID
  market: Market; ticker: string; name: string; day: string; time: string | null;
  side: Side; quantity: number; price: number; fee: number | null;
  fillKey: string | null;
  entryId: number | null; // 그날 적은 매수·매도 일지
  note: string | null; // 매수 이유 또는 매도 때 배운 것
};

export type Holding = { market: Market; ticker: string; name: string; quantity: number; avgPrice: number; pnlPct: number | null };

export type Label = "첫 매수" | "추가 매수" | "일부 매도" | "전량 매도" | "매도";
export type Page = BookEvent & { label: Label; held: number; avgCost: number | null; pnl: number | null };

export type Book = {
  key: string; market: Market; ticker: string; name: string;
  start: string | null; end: string | null; // start가 null이면 키움 기록보다 먼저 산 것만 있어요
  startedBefore: boolean; // 키움에서 받은 기록보다 먼저 산 주식이 들어 있어요
  pages: Page[];
  days: number | null; buys: number; sells: number; maxHeld: number;
  realized: number | null; // 판 것의 손익(수수료·세금 뺀 값). 원가를 모르는 매도가 있으면 null
  fees: number; returnPct: number | null; avgCost: number | null; held: number;
};

const EPS = 1e-6;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const bookKey = (market: Market, ticker: string, end: string | null) => `${market}:${ticker}:${end ?? "open"}`;

// 같은 날 매수와 매도가 함께 있으면 체결 시각 순, 시각이 없으면 매수부터 봅니다.
function order(a: BookEvent, b: BookEvent): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  if (a.side !== b.side) return a.side === "buy" ? -1 : 1;
  return 0;
}

// 키움 평단은 이동평균이라, 지금 평단에서 기록을 거꾸로 돌리면 기록 전부터 갖고 있던 주식의 평단이 나옵니다.
// 중간에 보유가 0이 되면(그 앞은 다른 권) 알 수 없어서 null입니다.
function openingCost(events: BookEvent[], h: Holding | undefined): number | null {
  if (!h || h.quantity <= EPS || !(h.avgPrice > 0)) return null;
  let q = h.quantity, avg = h.avgPrice;
  for (const e of [...events].reverse()) {
    if (e.side === "sell") { q += e.quantity; continue; }
    const prev = q - e.quantity;
    if (prev <= EPS) return null;
    avg = (q * avg - e.quantity * e.price) / prev;
    q = prev;
  }
  return avg > 0 ? avg : null;
}

function emptyBook(e: { market: Market; ticker: string; name: string }, start: string | null, startedBefore: boolean): Book {
  return {
    key: "", market: e.market, ticker: e.ticker, name: e.name, start, end: null, startedBefore, pages: [],
    days: null, buys: 0, sells: 0, maxHeld: 0, realized: 0, fees: 0, returnPct: null, avgCost: null, held: 0,
  };
}

function finish(b: Book, cost: number, today: string, h: Holding | undefined): Book {
  b.key = bookKey(b.market, b.ticker, b.end);
  b.days = b.start ? daysBetween(b.start, b.end ?? today) : null;
  if (b.realized !== null) b.realized -= b.fees;
  if (b.end) b.returnPct = b.realized !== null && cost > 0 ? Math.round((b.realized / cost) * 10000) / 100 : null;
  else b.returnPct = h?.pnlPct ?? null;
  if (!b.end && h?.name) b.name = h.name;
  return b;
}

export function buildBooks(events: BookEvent[], holdings: Holding[], today: string): Book[] {
  const byStock = new Map<string, BookEvent[]>();
  for (const e of events) {
    const k = `${e.market}:${e.ticker}`;
    byStock.set(k, [...(byStock.get(k) ?? []), e]);
  }
  for (const h of holdings) if (h.quantity > EPS && !byStock.has(`${h.market}:${h.ticker}`)) byStock.set(`${h.market}:${h.ticker}`, []);
  const hold = new Map(holdings.map((h) => [`${h.market}:${h.ticker}`, h]));

  const books: Book[] = [];
  for (const [k, list] of byStock) {
    const evs = [...list].sort(order);
    const h = hold.get(k);
    const sum = (side: Side) => evs.filter((e) => e.side === side).reduce((s, e) => s + e.quantity, 0);
    const opening = Math.max(0, (h?.quantity ?? 0) - sum("buy") + sum("sell"));
    const base = evs[0] ?? { market: h!.market, ticker: h!.ticker, name: h!.name };

    let q = opening, avg = opening > EPS ? openingCost(evs, h) : null, cost = 0;
    let cur: Book | null = opening > EPS ? emptyBook(base, evs[0]?.day ?? null, true) : null;
    if (cur) cur.maxHeld = opening;
    for (const e of evs) {
      if (e.side === "buy") {
        if (!cur || q <= EPS) { cur = emptyBook(e, e.day, false); q = 0; avg = 0; cost = 0; }
        const first = !cur.startedBefore && cur.buys === 0;
        avg = avg === null ? null : (q * avg + e.quantity * e.price) / (q + e.quantity);
        q += e.quantity;
        cur.buys += 1;
        cur.pages.push({ ...e, label: first ? "첫 매수" : "추가 매수", held: q, avgCost: avg, pnl: null });
      } else {
        // 판 수량이 가진 것보다 많으면 기록 전부터 있던 주식이에요(원가 모름).
        if (!cur) { cur = emptyBook(e, e.day, true); cost = 0; }
        if (e.quantity > q + EPS) { cur.startedBefore = true; avg = null; q = e.quantity; cur.maxHeld = Math.max(cur.maxHeld, q); }
        const pnl = avg === null ? null : e.quantity * (e.price - avg);
        cur.realized = cur.realized === null || pnl === null ? null : cur.realized + pnl;
        if (avg !== null) cost += e.quantity * avg;
        q -= e.quantity;
        cur.sells += 1;
        const all = q <= EPS;
        cur.pages.push({ ...e, label: all ? "전량 매도" : cur.startedBefore && cur.buys === 0 ? "매도" : "일부 매도", held: all ? 0 : q, avgCost: avg, pnl });
      }
      cur.fees += e.fee ?? 0;
      cur.maxHeld = Math.max(cur.maxHeld, q);
      if (q <= EPS) {
        q = 0;
        cur.end = e.day;
        books.push(finish(cur, cost, today, h));
        cur = null;
      }
    }
    if (cur) {
      cur.held = q;
      cur.avgCost = avg;
      books.push(finish(cur, cost, today, h));
    }
  }
  // 책장은 먼저 시작한 권이 위로. 시작을 모르는 권(기록 전부터 갖고 있던 것)이 맨 위예요.
  return books.sort((a, b) => (a.start ?? "") < (b.start ?? "") ? -1 : (a.start ?? "") > (b.start ?? "") ? 1 : a.name.localeCompare(b.name, "ko"));
}

export type Shelf = "all" | "open" | "closed" | "unreviewed";
export function onShelf(b: Book, shelf: Shelf, reviewed: (key: string) => boolean): boolean {
  if (shelf === "open") return b.end === null;
  if (shelf === "closed") return b.end !== null;
  if (shelf === "unreviewed") return b.end !== null && !reviewed(b.key);
  return true;
}

// 올해가 아닌 날짜에는 연도를 붙입니다.
export function shortDay(day: string, today: string): string {
  return day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day.replaceAll("-", ".");
}
