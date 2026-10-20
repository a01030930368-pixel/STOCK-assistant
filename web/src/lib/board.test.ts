import { describe, expect, it } from "vitest";
import { distancePct, scopeOf, totalOf } from "./board";

const kr = { eval: 2_000_000, buy: 1_900_000, pnl: 100_000, cash: 1_000_000 };
const us = { eval: 1000, buy: 1100, pnl: -100, cash: 200 };

describe("totalOf", () => {
  it("adds stocks and cash in won for all", () => {
    const t = totalOf("all", kr, us, 1400);
    expect(t.currency).toBe("KRW");
    expect(t.total).toBe(3_000_000 + 1200 * 1400);
    expect(t.pnl).toBe(100_000 - 140_000);
    expect(t.pnlPct).toBeCloseTo((-40_000 / (1_900_000 + 1_540_000)) * 100);
  });
  it("keeps dollars for US only", () => {
    const t = totalOf("US", kr, us, 1400);
    expect(t.currency).toBe("USD");
    expect(t.total).toBe(1200);
    expect(t.cash).toBe(200);
  });
  it("adds ISA to all and shows it alone on its tab", () => {
    const isa = { eval: 5_000_000, buy: 4_500_000, pnl: 500_000, cash: 10_000 };
    expect(totalOf("all", kr, us, 1400, isa).total).toBe(3_000_000 + 1200 * 1400 + 5_010_000);
    expect(totalOf("KR", kr, us, 1400, isa).total).toBe(3_000_000);
    const t = totalOf("ISA", kr, us, 1400, isa);
    expect([t.currency, t.total, t.pnl]).toEqual(["KRW", 5_010_000, 500_000]);
  });
  it("treats unknown cash as zero", () => {
    expect(totalOf("KR", { ...kr, cash: null }, null, 0).total).toBe(2_000_000);
  });
});

describe("distancePct", () => {
  it("measures distance to a stop below", () => {
    expect(distancePct({ kind: "stop", direction: "below", price: 90, cur: 100 })).toBe(10);
  });
  it("measures distance to a target above and clamps passed alerts", () => {
    expect(distancePct({ kind: "target", direction: "above", price: 110, cur: 100 })).toBe(10);
    expect(distancePct({ kind: "target", direction: "above", price: 90, cur: 100 })).toBe(0);
  });
});

it("scopeOf defaults to all", () => {
  expect(scopeOf("KR")).toBe("KR");
  expect(scopeOf("ISA")).toBe("ISA");
  expect(scopeOf(undefined)).toBe("all");
  expect(scopeOf("x")).toBe("all");
});
