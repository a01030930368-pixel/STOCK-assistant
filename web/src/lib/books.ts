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
  skipped?: boolean; // 매매일지에서 '일지 안 씀'을 누른 체결
};

export type FillRow = {
  key: string; market: Market; day: string; time: string | null; ticker: string; name: string; side: Side;
  quantity: string; price: string; fee: string | null; hidden?: boolean;
};
export type EntryRow = { id: number; side: Side; fill_key: string | null; market: Market; ticker: string; name: string; day: string; quantity: string; price: string; note: string };

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

// 같은 날 두 번 다 판 종목(단타)은 두 번째 권부터 키 뒤에 #2, #3을 붙여 사후강평이 섞이지 않게 합니다.
function uniqueKey(key: string, used: Set<string>): string {
  let out = key;
  for (let n = 2; used.has(out); n++) out = `${key}#${n}`;
  used.add(out);
  return out;
}

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

function finish(b: Book, cost: number, today: string, h: Holding | undefined, used: Set<string>): Book {
  b.key = uniqueKey(bookKey(b.market, b.ticker, b.end), used);
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
  const used = new Set<string>();
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
        books.push(finish(cur, cost, today, h, used));
        cur = null;
      }
    }
    if (cur) {
      cur.held = q;
      cur.avgCost = avg;
      books.push(finish(cur, cost, today, h, used));
    }
  }
  // 책장은 먼저 시작한 권이 위로. 시작을 모르는 권(기록 전부터 갖고 있던 것)이 맨 위예요.
  return books.sort((a, b) => (a.start ?? "") < (b.start ?? "") ? -1 : (a.start ?? "") > (b.start ?? "") ? 1 : a.name.localeCompare(b.name, "ko"));
}

const NEAR_DAYS = 3;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// 체결에 일지를 붙입니다. 체결 키가 같으면 그 체결, 아니면 같은 시장·종목·매수/매도 중 날짜가 가장 가까운(3일 안) 체결에 붙여요.
// 미국 주식은 한국 날짜로 적어 하루 어긋나기 쉽고, 하루 두 번 산 걸 일지 두 장으로 써도 키움은 한 묶음이라
// 어긋난 일지를 따로 더하면 없는 주식이 생깁니다. 가까운 체결이 없을 때만 손으로 적은 매매로 따로 넣어요.
export function attachEntries(fills: FillRow[], entries: EntryRow[]): (BookEvent & { entryIds: string[] })[] {
  const events = fills.map((f) => ({
    id: f.key, market: f.market, ticker: f.ticker, name: f.name, day: f.day, time: f.time, side: f.side,
    quantity: Number(f.quantity), price: Number(f.price), fee: f.fee === null ? null : Number(f.fee), skipped: f.hidden === true,
    fillKey: f.key, entryId: null as number | null, note: null as string | null, entryIds: [] as string[],
  }));
  const attach = (ev: (typeof events)[number], e: EntryRow) => {
    ev.entryIds.push(`${e.side}:${e.id}`);
    if (ev.entryId === null) { ev.entryId = e.id; ev.note = e.note; }
    else if (e.note && e.note !== ev.note) ev.note = ev.note ? `${ev.note}\n${e.note}` : e.note;
  };
  const rest: EntryRow[] = [];
  for (const e of entries) {
    const ev = e.fill_key ? events.find((x) => x.fillKey === e.fill_key) : undefined;
    if (ev) attach(ev, e); else rest.push(e);
  }
  for (const e of rest) {
    const near = events
      .filter((x) => x.side === e.side && x.ticker === e.ticker && x.market === e.market && dayGap(x.day, e.day) <= NEAR_DAYS)
      .sort((a, b) => (a.entryId === null ? 0 : 1) - (b.entryId === null ? 0 : 1) || dayGap(a.day, e.day) - dayGap(b.day, e.day));
    if (near[0]) attach(near[0], e);
  }
  return events;
}

// 키로 권을 찾습니다. 보유 중일 때 저장해 둔 링크(…:open)는 다 팔아 권이 끝났으면 그 종목의 가장 최근 권을 보여 줘요.
export function findBook(books: Book[], key: string | undefined): Book | undefined {
  if (!key) return undefined;
  const found = books.find((b) => b.key === key);
  if (found || !key.endsWith(":open")) return found;
  const stock = key.slice(0, -":open".length);
  return books.filter((b) => `${b.market}:${b.ticker}` === stock).sort((a, b) => ((a.end ?? "9999") < (b.end ?? "9999") ? -1 : 1)).at(-1);
}

// 매도만 있고 그 앞 매수는 키움 기록에도 일지에도 없는 끝난 권(오래전에 산 주식). 언제 샀는지 몰라 책장에서 뺍니다.
// 강평을 이미 썼으면 그대로 보여 줘요.
export const sellOnly = (b: Book) => b.end !== null && b.buys === 0;

// 매수를 전부 매매일지에서 '일지 안 씀'으로 넘긴 끝난 권(장난으로 친 단타 같은 것). 일지를 한 장이라도 썼으면 남겨요.
export const skipped = (b: Book) => {
  const buys = b.pages.filter((p) => p.side === "buy");
  return b.end !== null && buys.length > 0 && buys.every((p) => p.skipped && p.entryId === null);
};

export type Shelf = "all" | "open" | "closed" | "unreviewed";
export function onShelf(b: Book, shelf: Shelf, reviewed: (key: string) => boolean): boolean {
  if ((sellOnly(b) || skipped(b)) && !reviewed(b.key)) return false;
  if (shelf === "open") return b.end === null;
  if (shelf === "closed") return b.end !== null;
  if (shelf === "unreviewed") return b.end !== null && !reviewed(b.key);
  return true;
}

// 올해가 아닌 날짜에는 연도를 붙입니다.
export function shortDay(day: string, today: string): string {
  return day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day.replaceAll("-", ".");
}
