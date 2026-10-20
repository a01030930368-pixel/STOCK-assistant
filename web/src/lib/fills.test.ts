import { describe, expect, it } from "vitest";
import { formNumber, journalHref, type KiwoomFill } from "./fills";

const f = (over: Partial<KiwoomFill>): KiwoomFill => ({
  key: "KR:2026-10-20:000660:buy", market: "KR", day: "2026-10-20", time: "09:12", ticker: "000660", name: "SK하이닉스",
  side: "buy", quantity: 5, price: 212500, fee: 160, count: 1, done: false, positionId: null, ...over,
});

describe("fill helpers", () => {
  it("links buys to the buy form and sells to the open journal", () => {
    expect(journalHref(f({}))).toBe("/journal/buy?fill=KR%3A2026-10-20%3A000660%3Abuy");
    expect(journalHref(f({ side: "sell", key: "KR:2026-10-14:000660:sell", positionId: 7 }))).toBe("/journal/7?fill=KR%3A2026-10-14%3A000660%3Asell#sell");
    expect(journalHref(f({ side: "sell", positionId: null }))).toBeNull();
  });
  it("formats numbers for the form", () => {
    expect(formNumber(61240.0001, "KR")).toBe("61240");
    expect(formNumber(182.4, "US")).toBe("182.4");
    expect(formNumber(176.123456, "US")).toBe("176.1235");
  });
});
