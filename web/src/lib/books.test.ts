import { describe, expect, it } from "vitest";
import { attachEntries, buildBooks, findBook, onShelf, shortDay, type BookEvent, type EntryRow, type FillRow, type Holding } from "./books";

let n = 0;
const ev = (day: string, side: "buy" | "sell", quantity: number, price: number, over: Partial<BookEvent> = {}): BookEvent => ({
  id: `KR:${day}:000660:${side}:${n++}`, market: "KR", ticker: "000660", name: "SK하이닉스", day, time: null, side, quantity, price,
  fee: null, fillKey: null, entryId: null, note: null, ...over,
});

describe("buildBooks", () => {
  it("makes one book from first buy to full sell and starts a new one on rebuy", () => {
    const books = buildBooks([
      ev("2026-08-04", "buy", 10, 168000, { fee: 250 }),
      ev("2026-08-21", "buy", 5, 181500),
      ev("2026-09-15", "sell", 7, 214000, { fee: 3000 }),
      ev("2026-10-14", "sell", 8, 251000, { fee: 3000 }),
      ev("2026-10-17", "buy", 2, 260000),
    ], [{ market: "KR", ticker: "000660", name: "SK하이닉스", quantity: 2, avgPrice: 260000, pnlPct: 1.5 }], "2026-10-20");
    expect(books.map((b) => b.key)).toEqual(["KR:000660:2026-10-14", "KR:000660:open"]);
    const [done, open] = books;
    expect(done.pages.map((p) => [p.label, p.held])).toEqual([["첫 매수", 10], ["추가 매수", 15], ["일부 매도", 8], ["전량 매도", 0]]);
    expect(done.pages[1].avgCost).toBe(172500);
    expect(done.realized).toBe(7 * 41500 + 8 * 78500 - 6250);
    expect(done.returnPct).toBe(Math.round(((7 * 41500 + 8 * 78500 - 6250) / (15 * 172500)) * 10000) / 100);
    expect([done.days, done.buys, done.sells, done.maxHeld]).toEqual([71, 2, 2, 15]);
    expect([open.start, open.end, open.returnPct, open.held]).toEqual(["2026-10-17", null, 1.5, 2]);
  });

  it("marks shares bought before the Kiwoom history and works out their cost from today's average", () => {
    // 기록 전에 10주를 100에 샀고, 기록 안에서 10주를 200에 추가 → 지금 20주 평단 150
    const [b] = buildBooks([ev("2026-09-01", "buy", 10, 200), ev("2026-09-10", "sell", 5, 180)],
      [{ market: "KR", ticker: "000660", name: "SK하이닉스", quantity: 15, avgPrice: 150, pnlPct: 10 }], "2026-10-20");
    expect(b.startedBefore).toBe(true);
    expect(b.pages.map((p) => p.label)).toEqual(["추가 매수", "일부 매도"]);
    expect(b.pages[0].avgCost).toBe(150);
    expect(b.realized).toBe(5 * 30);
  });

  it("keeps a sell of shares it never saw bought, without a made-up return", () => {
    const [b] = buildBooks([ev("2026-08-01", "sell", 3, 50000)], [], "2026-10-20");
    expect([b.key, b.startedBefore, b.realized, b.returnPct, b.pages[0].label]).toEqual(["KR:000660:2026-08-01", true, null, null, "전량 매도"]);
  });

  it("shows a holding with no fills as a book that started before the history", () => {
    const h: Holding = { market: "US", ticker: "IONQ", name: "아이온큐", quantity: 4, avgPrice: 30, pnlPct: 5 };
    const [b] = buildBooks([], [h], "2026-10-20");
    expect([b.key, b.start, b.startedBefore, b.pages.length, b.returnPct]).toEqual(["US:IONQ:open", null, true, 0, 5]);
  });

  it("orders the shelf by start date, oldest on top", () => {
    const books = buildBooks([
      ev("2026-09-01", "buy", 1, 10, { ticker: "B", name: "나중" }),
      ev("2026-07-01", "buy", 1, 10, { ticker: "A", name: "먼저" }),
    ], [], "2026-10-20");
    expect(books.map((b) => b.name)).toEqual(["먼저", "나중"]);
  });

  it("puts a same-day buy before the sell when there is no time", () => {
    const [b] = buildBooks([ev("2026-10-01", "sell", 1, 12), ev("2026-10-01", "buy", 1, 10)], [], "2026-10-20");
    expect(b.pages.map((p) => p.side)).toEqual(["buy", "sell"]);
    expect(b.realized).toBe(2);
  });
});

describe("shelf helpers", () => {
  it("filters and formats", () => {
    const [b] = buildBooks([ev("2026-10-01", "buy", 1, 10), ev("2026-10-02", "sell", 1, 12)], [], "2026-10-20");
    expect(onShelf(b, "unreviewed", () => false)).toBe(true);
    expect(onShelf(b, "unreviewed", () => true)).toBe(false);
    expect(onShelf(b, "open", () => false)).toBe(false);
    expect(shortDay("2026-10-02", "2026-10-20")).toBe("10-02");
    expect(shortDay("2025-10-02", "2026-10-20")).toBe("2025.10.02");
  });
});

describe("book keys", () => {
  it("gives a second same-day round trip its own key", () => {
    const books = buildBooks([
      ev("2026-10-01", "buy", 1, 100, { time: "09:01" }), ev("2026-10-01", "sell", 1, 110, { time: "09:30" }),
      ev("2026-10-01", "buy", 1, 105, { time: "10:00" }), ev("2026-10-01", "sell", 1, 120, { time: "11:00" }),
    ], [], "2026-10-20");
    expect(books.map((b) => b.key)).toEqual(["KR:000660:2026-10-01", "KR:000660:2026-10-01#2"]);
  });
});

describe("attachEntries", () => {
  const fill = (key: string, day: string, side: "buy" | "sell", quantity: number): FillRow => ({
    key, market: "US", day, time: null, ticker: "AAPL", name: "Apple", side, quantity: String(quantity), price: "100", fee: null,
  });
  const entry = (id: number, day: string, side: "buy" | "sell", note: string): EntryRow => ({
    id, side, fill_key: null, market: "US", ticker: "AAPL", name: "Apple", day, quantity: "10", price: "100", note,
  });

  it("attaches an entry written a day off to the nearest fill instead of adding shares", () => {
    const events = attachEntries(
      [fill("b", "2026-10-01", "buy", 10), fill("s", "2026-10-05", "sell", 10)],
      [entry(1, "2026-10-02", "buy", "이유")],
    );
    expect(events.map((e) => [e.id, e.entryId, e.note])).toEqual([["b", 1, "이유"], ["s", null, null]]);
    const books = buildBooks(events, [], "2026-10-20");
    expect(books.map((b) => b.end)).toEqual(["2026-10-05"]);
  });

  it("puts two entries for one combined fill on the same page", () => {
    const events = attachEntries([fill("b", "2026-10-01", "buy", 20)],
      [entry(1, "2026-10-01", "buy", "첫째"), entry(2, "2026-10-01", "buy", "둘째")]);
    expect(events[0].entryIds).toEqual(["buy:1", "buy:2"]);
    expect(events[0].note).toBe("첫째\n둘째");
  });

  it("leaves entries far from any fill for the caller to add by hand", () => {
    const events = attachEntries([fill("b", "2026-10-01", "buy", 10)], [entry(1, "2026-09-01", "buy", "옛날")]);
    expect(events[0].entryIds).toEqual([]);
  });
});

describe("findBook", () => {
  it("opens the latest book of a stock from an old open-book link", () => {
    const books = buildBooks([ev("2026-10-01", "buy", 1, 100), ev("2026-10-05", "sell", 1, 110)], [], "2026-10-20");
    expect(findBook(books, "KR:000660:open")?.key).toBe("KR:000660:2026-10-05");
    expect(findBook(books, "KR:000660:2026-09-01")).toBeUndefined();
  });
});
