"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool, query } from "@/lib/db";
import { optionalNumber, validateMacro, type MacroInput } from "@/lib/macro";
import { rulesFromForm } from "@/lib/screener";
import { averageBefore, averagePrice, holdingDays, marketOf as tickerMarket, remainingQuantity, returnPct, sameQuantity, validateBuy, type BuyInput, type Fill } from "@/lib/journal";
import type { Book } from "@/lib/books";
import { loadBook } from "@/lib/booksData";
import { KIND_LABEL, validColor, validDoodle, type DoodlePoint, type LevelKind } from "@/lib/drawings";

// values: 오류가 났을 때 입력한 값을 폼에 되돌려 주기 위해 사용합니다.
export type FormState = { errors: string[]; values?: Record<string, string> };

const echo = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => Number(text(form, key).replace(/,/g, ""));

// 매매일 당시(그날 또는 그 전 가장 최근)의 매크로 메모를 연결합니다.
async function snapshotFor(date: string): Promise<number | null> {
  const [row] = await query<{ id: number }>(
    "SELECT id FROM macro_snapshots WHERE snapshot_date <= $1 ORDER BY snapshot_date DESC LIMIT 1",
    [date],
  );
  return row?.id ?? null;
}

export async function addPrinciple(form: FormData) {
  const body = text(form, "body");
  const kind = text(form, "kind") === "crisis" ? "crisis" : "trading";
  if (body) await query("INSERT INTO principles (kind, body) VALUES ($1, $2)", [kind, body]);
  revalidatePath("/journal");
}

export async function deletePrinciple(form: FormData) {
  await query("DELETE FROM principles WHERE id = $1", [num(form, "id")]);
  revalidatePath("/journal");
}

const bookHref = (key: string) => `/journal/books?b=${encodeURIComponent(key)}`;
const DAY_MS = 86_400_000;

// 일기장에서 쓴 일지는 그 권에 딸린 일지 묶음(positions.book_key)에 넣습니다.
// 진행 중인 권이면 예전에 손으로 만든 보유 중 일지를 이어 씁니다.
async function bookPosition(book: Book): Promise<number> {
  const [own] = await query<{ id: number }>("SELECT id FROM positions WHERE book_key = $1 LIMIT 1", [book.key]);
  if (own) return own.id;
  if (!book.end) {
    const [open] = await query<{ id: number }>(
      "UPDATE positions SET book_key = $1 WHERE id = (SELECT id FROM positions WHERE ticker = $2 AND status = 'open' AND book_key IS NULL ORDER BY id LIMIT 1) RETURNING id",
      [book.key, book.ticker],
    );
    if (open) return open.id;
  }
  const [row] = await query<{ id: number }>(
    "INSERT INTO positions (ticker, name, market, status, closed_at, book_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [book.ticker, book.name, book.market, book.end ? "closed" : "open", book.end, book.key],
  );
  return row.id;
}

async function replaceAlerts(positionId: number, ticker: string, name: string, stop: number, target: number) {
  await query("UPDATE alerts SET active = false WHERE position_id = $1 AND kind IN ('stop', 'target') AND active", [positionId]);
  await query(
    `INSERT INTO alerts (position_id, ticker, name, kind, direction, price) VALUES
       ($1, $2, $3, 'stop', 'below', $4), ($1, $2, $3, 'target', 'above', $5)`,
    [positionId, ticker, name, stop, target],
  );
}

function buyInput(form: FormData): BuyInput {
  return {
    tradeDate: text(form, "tradeDate"),
    ticker: text(form, "ticker").toUpperCase(),
    name: text(form, "name"),
    market: tickerMarket(text(form, "ticker"), text(form, "market") === "US" ? "US" : "KR"),
    quantity: num(form, "quantity"),
    price: num(form, "price"),
    reason: text(form, "reason"),
    scenario: text(form, "scenario"),
    risks: [text(form, "risk1"), text(form, "risk2"), text(form, "risk3")],
    weightPct: num(form, "weightPct"),
    stopPrice: num(form, "stopPrice"),
    targetPrice: num(form, "targetPrice"),
    targetBasis: text(form, "targetBasis") === "percent" ? "percent" : "chart",
  };
}

export async function createBuy(_prev: FormState, form: FormData): Promise<FormState> {
  const input = buyInput(form);
  const errors = validateBuy(input);
  if (errors.length) return { errors, values: echo(form) };
  const entryId = num(form, "entryId");
  if (entryId > 0) return updateBuy(entryId, input, text(form, "bookKey"));

  const bookKey = text(form, "bookKey");
  const book = bookKey ? await loadBook(bookKey) : undefined;
  if (bookKey && !book) return { errors: ["일기장을 찾지 못했어요. 책장에서 다시 열어 주세요."], values: echo(form) };
  const snapshotId = await snapshotFor(input.tradeDate);
  let positionId: number;
  if (book) {
    positionId = await bookPosition(book);
    await query(
      `INSERT INTO buy_entries (position_id, trade_date, quantity, price, reason, scenario, risk_1, risk_2, risk_3,
         weight_pct, stop_price, target_price, target_basis, macro_snapshot_id, fill_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [positionId, input.tradeDate, input.quantity, input.price, input.reason, input.scenario, ...input.risks,
        input.weightPct, input.stopPrice, input.targetPrice, input.targetBasis, snapshotId, text(form, "fillKey") || null],
    );
    // 끝난 권의 옛 매수는 알림을 만들지 않고, 진행 중인 권의 가장 최근 매수만 알림을 바꿉니다.
    const last = book.pages.filter((p) => p.side === "buy").at(-1);
    if (!book.end && (!last || input.tradeDate >= last.day)) await replaceAlerts(positionId, book.ticker, book.name, input.stopPrice, input.targetPrice);
    revalidatePath("/journal");
    redirect(bookHref(book.key));
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: number }>(
      "SELECT id FROM positions WHERE ticker = $1 AND status = 'open' LIMIT 1",
      [input.ticker],
    );
    positionId =
      existing.rows[0]?.id ??
      (
        await client.query<{ id: number }>(
          "INSERT INTO positions (ticker, name, market) VALUES ($1, $2, $3) RETURNING id",
          [input.ticker, input.name, input.market],
        )
      ).rows[0].id;
    await client.query(
      `INSERT INTO buy_entries (position_id, trade_date, quantity, price, reason, scenario, risk_1, risk_2, risk_3,
         weight_pct, stop_price, target_price, target_basis, macro_snapshot_id, fill_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [positionId, input.tradeDate, input.quantity, input.price, input.reason, input.scenario, ...input.risks,
        input.weightPct, input.stopPrice, input.targetPrice, input.targetBasis, snapshotId, text(form, "fillKey") || null],
    );
    // 가장 최근 매수 기록의 손절·익절가로 알림을 교체합니다.
    await client.query("UPDATE alerts SET active = false WHERE position_id = $1 AND kind IN ('stop', 'target') AND active", [positionId]);
    await client.query(
      `INSERT INTO alerts (position_id, ticker, name, kind, direction, price) VALUES
         ($1, $2, $3, 'stop', 'below', $4), ($1, $2, $3, 'target', 'above', $5)`,
      [positionId, input.ticker, input.name, input.stopPrice, input.targetPrice],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  revalidatePath("/journal");
  redirect(`/journal/${positionId}`);
}

// 예전에 쓴 매수 일지 고치기. 종목은 그대로 두고 날짜·수량·가격과 체크리스트만 바꿉니다.
async function updateBuy(id: number, input: BuyInput, bookKey: string): Promise<FormState> {
  const [row] = await query<{ position_id: number }>(
    `UPDATE buy_entries SET trade_date = $2, quantity = $3, price = $4, reason = $5, scenario = $6, risk_1 = $7, risk_2 = $8, risk_3 = $9,
       weight_pct = $10, stop_price = $11, target_price = $12, target_basis = $13,
       -- 날짜·가격이 바뀌었을 수 있어 당시 차트와 매크로를 다시 남깁니다.
       chart_png = CASE WHEN trade_date = $2 AND price = $4 AND stop_price = $11 AND target_price = $12 THEN chart_png END,
       context = CASE WHEN trade_date = $2 THEN context END
     WHERE id = $1 RETURNING position_id`,
    [id, input.tradeDate, input.quantity, input.price, input.reason, input.scenario, ...input.risks,
      input.weightPct, input.stopPrice, input.targetPrice, input.targetBasis],
  );
  if (!row) return { errors: ["고칠 매수 일지를 찾지 못했어요."] };
  const [pos] = await query<{ book_key: string | null }>("SELECT book_key FROM positions WHERE id = $1", [row.position_id]);
  if (pos && !pos.book_key) await recomputePosition(row.position_id);
  const [latest] = await query<{ id: number; ticker: string; name: string; status: string }>(
    `SELECT b.id, p.ticker, p.name, p.status FROM buy_entries b JOIN positions p ON p.id = b.position_id
     WHERE b.position_id = $1 ORDER BY b.trade_date DESC, b.id DESC LIMIT 1`,
    [row.position_id],
  );
  if (latest?.id === id && latest.status === "open") await replaceAlerts(row.position_id, latest.ticker, latest.name, input.stopPrice, input.targetPrice);
  revalidatePath("/journal");
  revalidatePath(`/journal/${row.position_id}`);
  redirect(bookKey ? bookHref(bookKey) : `/journal/${row.position_id}`);
}

type FillRow = { id: number; trade_date: string; quantity: string; price: string };
const toFill = (r: FillRow): Fill => ({ tradeDate: r.trade_date, quantity: Number(r.quantity), price: Number(r.price) });

async function positionFills(positionId: number, skipSell = 0) {
  const cols = "id, to_char(trade_date, 'YYYY-MM-DD') AS trade_date, quantity, price";
  const buys = (await query<FillRow>(`SELECT ${cols} FROM buy_entries WHERE position_id = $1`, [positionId])).map(toFill);
  const sellRows = await query<FillRow>(`SELECT ${cols} FROM sell_entries WHERE position_id = $1 AND id <> $2`, [positionId, skipSell]);
  return { buys, sells: sellRows.map(toFill), sellRows };
}

// 손으로 쓴 일지를 고친 뒤: 매도마다 평단·수익률을 다시 계산하고, 다 팔았는지에 따라 보유 중/끝남을 다시 정합니다.
async function recomputePosition(positionId: number) {
  const { buys, sells, sellRows } = await positionFills(positionId);
  if (buys.length) {
    for (const r of sellRows) {
      const avg = averageBefore(buys, r.trade_date);
      await query("UPDATE sell_entries SET avg_buy_price = $2, return_pct = $3 WHERE id = $1", [r.id, avg, returnPct(avg, Number(r.price))]);
    }
  }
  const remaining = remainingQuantity(buys, sells);
  const [p] = await query<{ status: string; ticker: string; name: string }>("SELECT status, ticker, name FROM positions WHERE id = $1", [positionId]);
  if (!p) return;
  if (remaining <= 1e-6 && p.status === "open") {
    await query("UPDATE positions SET status = 'closed', closed_at = now() WHERE id = $1", [positionId]);
    await query("UPDATE alerts SET active = false WHERE position_id = $1 AND active", [positionId]);
  } else if (remaining > 1e-6 && p.status === "closed") {
    await query("UPDATE positions SET status = 'open', closed_at = NULL WHERE id = $1", [positionId]);
    const [last] = await query<{ stop_price: string; target_price: string }>(
      "SELECT stop_price, target_price FROM buy_entries WHERE position_id = $1 ORDER BY trade_date DESC, id DESC LIMIT 1", [positionId]);
    if (last) await replaceAlerts(positionId, p.ticker, p.name, Number(last.stop_price), Number(last.target_price));
  }
}

type SellInput = { tradeDate: string; quantity: number; price: number; reasonType: string; reasonDetail: string; lesson: string; followed: string };

function sellInput(form: FormData): SellInput {
  return {
    tradeDate: text(form, "tradeDate"), quantity: num(form, "quantity"), price: num(form, "price"), reasonType: text(form, "reasonType"),
    reasonDetail: text(form, "reasonDetail"), lesson: text(form, "lesson"), followed: text(form, "followedRules"),
  };
}

function sellErrors(s: SellInput, remaining: number | null): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.tradeDate)) errors.push("매도일을 입력하세요.");
  if (remaining === null ? !(s.quantity > 0) : !(s.quantity > 0 && s.quantity <= remaining + 1e-6)) {
    errors.push(remaining === null ? "매도 수량을 입력하세요." : `매도 수량은 0보다 크고 남은 수량(${remaining}) 이하여야 합니다.`);
  }
  if (!(s.price > 0)) errors.push("매도가를 입력하세요.");
  if (!["stop", "target", "other"].includes(s.reasonType)) errors.push("매도 이유를 고르세요.");
  if (!s.lesson) errors.push("배운 것을 적어야 합니다.");
  if (s.followed !== "yes" && s.followed !== "no") errors.push("원칙을 지켰는지 고르세요.");
  return errors;
}

export async function createSell(_prev: FormState, form: FormData): Promise<FormState> {
  const input = sellInput(form);
  const entryId = num(form, "entryId");
  const bookKey = text(form, "bookKey");
  if (entryId > 0) return updateSell(entryId, input, bookKey, echo(form));
  if (bookKey) return createBookSell(input, bookKey, text(form, "fillKey"), echo(form));
  const positionId = num(form, "positionId");
  const { tradeDate, quantity, price, reasonType, lesson, followed } = input;

  const { buys, sells } = await positionFills(positionId);
  const remaining = remainingQuantity(buys, sells);

  const errors = sellErrors(input, remaining);
  if (errors.length) return { errors, values: echo(form) };

  const avgBuy = averagePrice(buys);
  await query(
    `INSERT INTO sell_entries (position_id, trade_date, quantity, price, avg_buy_price, return_pct, holding_days,
       reason_type, reason_detail, lesson, followed_rules, macro_snapshot_id, fill_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [positionId, tradeDate, quantity, price, avgBuy, returnPct(avgBuy, price), holdingDays(buys, tradeDate),
      reasonType, input.reasonDetail, lesson, followed === "yes", await snapshotFor(tradeDate), text(form, "fillKey") || null],
  );
  if (sameQuantity(quantity, remaining)) {
    await query("UPDATE positions SET status = 'closed', closed_at = now() WHERE id = $1", [positionId]);
    await query("UPDATE alerts SET active = false WHERE position_id = $1 AND active", [positionId]);
  }
  revalidatePath(`/journal/${positionId}`);
  revalidatePath("/journal");
  return { errors: [] };
}

// 일기장에서 쓰는 매도 일지. 평단과 보유 기간은 그 권의 체결로 계산합니다.
async function createBookSell(input: SellInput, bookKey: string, fillKey: string, values: Record<string, string>): Promise<FormState> {
  const errors = sellErrors(input, null);
  if (errors.length) return { errors, values };
  const book = await loadBook(bookKey);
  if (!book) return { errors: ["일기장을 찾지 못했어요. 책장에서 다시 열어 주세요."], values };
  const page = book.pages.find((p) => p.fillKey === fillKey);
  // 키움 기록보다 먼저 산 주식이라 평단을 모르면 평단·수익률을 비워 둡니다(통계에서 빠져요).
  const avgBuy = page?.avgCost ?? null;
  const days = book.start ? Math.max(0, Math.round((Date.parse(input.tradeDate) - Date.parse(book.start)) / DAY_MS)) : 0;
  const positionId = await bookPosition(book);
  await query(
    `INSERT INTO sell_entries (position_id, trade_date, quantity, price, avg_buy_price, return_pct, holding_days,
       reason_type, reason_detail, lesson, followed_rules, macro_snapshot_id, fill_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [positionId, input.tradeDate, input.quantity, input.price, avgBuy, avgBuy === null ? null : returnPct(avgBuy, input.price), days,
      input.reasonType, input.reasonDetail, input.lesson, input.followed === "yes", await snapshotFor(input.tradeDate), fillKey || null],
  );
  if (book.end) {
    await query("UPDATE positions SET status = 'closed', closed_at = COALESCE(closed_at, $2::date) WHERE id = $1", [positionId, book.end]);
    await query("UPDATE alerts SET active = false WHERE position_id = $1 AND active", [positionId]);
  }
  revalidatePath("/journal");
  redirect(bookHref(book.key));
}

// 예전에 쓴 매도 일지 고치기. 저장해 둔 평단으로 수익률을 다시 계산합니다.
async function updateSell(id: number, input: SellInput, bookKey: string, values: Record<string, string>): Promise<FormState> {
  // 손으로 쓴 일지 묶음이면, 이 매도를 뺀 나머지 기준으로 남은 수량보다 많이 팔았다고 고칠 수 없어요.
  const [own] = await query<{ position_id: number; book_key: string | null }>(
    "SELECT s.position_id, p.book_key FROM sell_entries s JOIN positions p ON p.id = s.position_id WHERE s.id = $1", [id]);
  let remaining: number | null = null;
  if (own && !own.book_key) {
    const { buys, sells } = await positionFills(own.position_id, id);
    remaining = remainingQuantity(buys, sells);
  }
  const errors = sellErrors(input, remaining);
  if (errors.length) return { errors, values };
  const [row] = await query<{ position_id: number; avg_buy_price: string }>(
    `UPDATE sell_entries SET holding_days = GREATEST(0, holding_days + ($2::date - trade_date)), trade_date = $2, quantity = $3, price = $4,
       return_pct = ROUND(($4 - avg_buy_price) / NULLIF(avg_buy_price, 0) * 100, 2), reason_type = $5, reason_detail = $6, lesson = $7,
       followed_rules = $8,
       chart_png = CASE WHEN trade_date = $2 AND price = $4 THEN chart_png END,
       context = CASE WHEN trade_date = $2 THEN context END
     WHERE id = $1 RETURNING position_id, avg_buy_price`,
    [id, input.tradeDate, input.quantity, input.price, input.reasonType, input.reasonDetail, input.lesson, input.followed === "yes"],
  );
  if (!row) return { errors: ["고칠 매도 일지를 찾지 못했어요."], values };
  if (own && !own.book_key) await recomputePosition(row.position_id);
  revalidatePath("/journal");
  revalidatePath(`/journal/${row.position_id}`);
  redirect(bookKey ? bookHref(bookKey) : `/journal/${row.position_id}`);
}

// 전량 매도한 권의 사후강평. 다시 저장하면 고칩니다.
export async function saveReview(form: FormData) {
  const key = text(form, "bookKey");
  if (!key || key.endsWith(":open")) return;
  const stars = num(form, "stars");
  const followed = text(form, "followedRules");
  await query(
    `INSERT INTO book_reviews (book_key, stars, followed_rules, thesis, plan, exit_timing, lesson, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (book_key) DO UPDATE SET stars = EXCLUDED.stars, followed_rules = EXCLUDED.followed_rules, thesis = EXCLUDED.thesis,
       plan = EXCLUDED.plan, exit_timing = EXCLUDED.exit_timing, lesson = EXCLUDED.lesson, updated_at = now()`,
    [key, stars >= 1 && stars <= 5 ? stars : null, followed === "yes" ? true : followed === "no" ? false : null,
      text(form, "thesis"), text(form, "plan"), text(form, "exitTiming"), text(form, "lesson")],
  );
  revalidatePath("/journal/books");
  redirect(bookHref(key));
}

// 일지에 남기지 않을 체결(예: 단타 테스트)은 목록에서 숨깁니다.
export async function hideFill(form: FormData) {
  await query("UPDATE trade_fills SET hidden = true WHERE fill_key = $1", [text(form, "key")]);
  revalidatePath("/journal");
}

export async function saveNotes(form: FormData) {
  const positionId = num(form, "positionId");
  await query("UPDATE positions SET notes = $1 WHERE id = $2", [text(form, "notes"), positionId]);
  revalidatePath(`/journal/${positionId}`);
}

export async function saveMacro(_prev: FormState, form: FormData): Promise<FormState> {
  const input: MacroInput = {
    snapshotDate: text(form, "snapshotDate"),
    krBaseRate: optionalNumber(text(form, "krBaseRate")),
    usBaseRate: optionalNumber(text(form, "usBaseRate")),
    usdkrw: optionalNumber(text(form, "usdkrw")),
    gdpOutlook: text(form, "gdpOutlook"),
    inflation: optionalNumber(text(form, "inflation")),
    usInflation: optionalNumber(text(form, "usInflation")),
    keyVariables: text(form, "keyVariables"),
    implications: text(form, "implications"),
  };
  const errors = validateMacro(input);
  if (errors.length) return { errors, values: echo(form) };

  // 같은 날짜에 다시 저장하면 그날 메모를 고칩니다.
  await query(
    `INSERT INTO macro_snapshots (snapshot_date, kr_base_rate, us_base_rate, usdkrw, gdp_outlook, inflation, us_inflation,
       key_variables, implications)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (snapshot_date) DO UPDATE SET kr_base_rate = EXCLUDED.kr_base_rate, us_base_rate = EXCLUDED.us_base_rate,
       usdkrw = EXCLUDED.usdkrw, gdp_outlook = EXCLUDED.gdp_outlook, inflation = EXCLUDED.inflation,
       us_inflation = EXCLUDED.us_inflation, key_variables = EXCLUDED.key_variables, implications = EXCLUDED.implications`,
    [input.snapshotDate, input.krBaseRate, input.usBaseRate, input.usdkrw, input.gdpOutlook, input.inflation,
      input.usInflation, input.keyVariables, input.implications],
  );
  revalidatePath("/macro");
  redirect("/macro");
}

export async function addPeer(form: FormData) {
  const ticker = text(form, "ticker").toUpperCase();
  const peer = text(form, "peerTicker").toUpperCase();
  const name = text(form, "peerName") || peer;
  const market = text(form, "peerMarket") === "US" ? "US" : "KR";
  if (ticker && peer && peer !== ticker) {
    await query(
      `INSERT INTO stock_peers (ticker, peer_ticker, peer_name, peer_market) VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticker, peer_ticker) DO UPDATE SET peer_name = EXCLUDED.peer_name, peer_market = EXCLUDED.peer_market`,
      [ticker, peer, name, market],
    );
  }
  revalidatePath(`/stock/${ticker}`);
}

export async function deletePeer(form: FormData) {
  const ticker = text(form, "ticker").toUpperCase();
  await query("DELETE FROM stock_peers WHERE ticker = $1 AND peer_ticker = $2", [ticker, text(form, "peerTicker").toUpperCase()]);
  revalidatePath(`/stock/${ticker}`);
}

export async function addChartMemo(form: FormData) {
  const ticker = text(form, "ticker").toUpperCase();
  const day = text(form, "day");
  const body = text(form, "body").slice(0, 500);
  if (ticker && /^\d{4}-\d{2}-\d{2}$/.test(day) && body) {
    await query("INSERT INTO chart_memos (ticker, day, body) VALUES ($1, $2, $3)", [ticker, day, body]);
  }
  revalidatePath(`/stock/${ticker}`);
}

export async function deleteChartMemo(form: FormData) {
  const ticker = text(form, "ticker").toUpperCase();
  await query("DELETE FROM chart_memos WHERE id = $1 AND ticker = $2", [num(form, "id"), ticker]);
  revalidatePath(`/stock/${ticker}`);
}

export async function savePreset(form: FormData) {
  const id = num(form, "id");
  const name = text(form, "name").slice(0, 40) || "내 조건";
  const rules = JSON.stringify(rulesFromForm((k) => text(form, k)));
  let target = id;
  if (id > 0) {
    await query("UPDATE screener_presets SET name = $2, rules = $3 WHERE id = $1", [id, name, rules]);
  } else {
    const [row] = await query<{ id: number }>("INSERT INTO screener_presets (name, rules) VALUES ($1, $2) RETURNING id", [name, rules]);
    target = row.id;
  }
  revalidatePath("/screener");
  redirect(`/screener?p=${target}`);
}

export async function deletePreset(form: FormData) {
  await query("DELETE FROM screener_presets WHERE id = $1", [num(form, "id")]);
  revalidatePath("/screener");
  redirect("/screener");
}

// ---------------------------------------------------------------- 관심종목·가격 알림

const marketOf = (form: FormData): "KR" | "US" => (text(form, "market") === "US" ? "US" : "KR");
const tickerOf = (form: FormData) => text(form, "ticker").toUpperCase().replace(/^A(\d{6})$/, "$1");

function refreshWatch(ticker?: string) {
  revalidatePath("/watch");
  revalidatePath("/");
  if (ticker) revalidatePath(`/stock/${ticker}`);
}

export async function addWatch(form: FormData) {
  const ticker = tickerOf(form);
  if (!ticker) return;
  const name = text(form, "name").slice(0, 60) || ticker;
  await query(
    `INSERT INTO watchlist (ticker, name, market, memo) VALUES ($1, $2, $3, $4)
     ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, market = EXCLUDED.market,
       memo = CASE WHEN EXCLUDED.memo = '' THEN watchlist.memo ELSE EXCLUDED.memo END`,
    [ticker, name, marketOf(form), text(form, "memo").slice(0, 200)],
  );
  const price = num(form, "price");
  if (price > 0) await insertAlert(ticker, name, text(form, "direction"), price, text(form, "memo"));
  refreshWatch(ticker);
}

export async function removeWatch(form: FormData) {
  const ticker = tickerOf(form);
  // 가진 종목에 건 알림은 남겨 둡니다(잔고 현재가로 계속 확인됨).
  await query(
    "DELETE FROM alerts WHERE ticker = $1 AND kind = 'custom' AND NOT EXISTS (SELECT 1 FROM holdings WHERE ticker = $1 AND quantity > 0)",
    [ticker],
  );
  await query("DELETE FROM watchlist WHERE ticker = $1", [ticker]);
  await query("DELETE FROM watch_quotes WHERE ticker = $1", [ticker]);
  refreshWatch(ticker);
}

async function insertAlert(ticker: string, name: string, direction: string, price: number, memo: string) {
  await query(
    "INSERT INTO alerts (ticker, name, kind, direction, price, memo) VALUES ($1, $2, 'custom', $3, $4, $5)",
    [ticker, name, direction === "below" ? "below" : "above", price, memo.slice(0, 200)],
  );
}

export async function addAlert(form: FormData) {
  const ticker = tickerOf(form);
  const price = num(form, "price");
  if (!ticker || !(price > 0)) return;
  await insertAlert(ticker, text(form, "name") || ticker, text(form, "direction"), price, text(form, "memo"));
  refreshWatch(ticker);
}

// 울린 알림을 다시 켜거나, 켜진 알림을 잠시 끕니다.
export async function toggleAlert(form: FormData) {
  const ticker = tickerOf(form);
  await query(
    "UPDATE alerts SET active = NOT active, triggered_at = CASE WHEN active THEN triggered_at ELSE NULL END WHERE id = $1 AND kind = 'custom'",
    [num(form, "id")],
  );
  refreshWatch(ticker);
}

export async function deleteAlert(form: FormData) {
  const ticker = tickerOf(form);
  await query("DELETE FROM alerts WHERE id = $1 AND kind = 'custom'", [num(form, "id")]);
  refreshWatch(ticker);
}

// ---------------------------------------------------------------- 비중

export async function saveLimits(form: FormData) {
  const clamp = (k: string, d: number) => {
    const v = num(form, k);
    return v > 0 && v <= 100 ? v : d;
  };
  const value = { sectorMax: clamp("sectorMax", 40), stockMax: clamp("stockMax", 20), cashMin: clamp("cashMin", 10) };
  await query(
    "INSERT INTO app_settings (key, value) VALUES ('weight_limits', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(value)],
  );
  revalidatePath("/weights");
}

// 매수 일지에 그날까지의 차트 그림을 한 번만 저장합니다(이미 있으면 그대로).
export async function saveChart(side: "buy" | "sell", id: number, dataUrl: string) {
  if (!Number.isInteger(id) || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 1_500_000) return;
  const table = side === "sell" ? "sell_entries" : "buy_entries";
  await query(`UPDATE ${table} SET chart_png = $2 WHERE id = $1 AND chart_png IS NULL`, [id, dataUrl]);
}

// ISA 유형(비과세 한도)과 개설일(만기 계산)
export async function saveIsa(form: FormData) {
  const opened = text(form, "opened");
  const value = { type: text(form, "type") === "low" ? "low" : "general", opened: /^\d{4}-\d{2}-\d{2}$/.test(opened) ? opened : null };
  await query(
    "INSERT INTO app_settings (key, value) VALUES ('isa', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(value)],
  );
  revalidatePath("/");
}

// 자동으로 받은 업종 이름을 직접 바꿉니다. 비우면 자동 이름으로 돌아갑니다.
export async function saveSector(form: FormData) {
  const ticker = tickerOf(form);
  const custom = text(form, "sector").slice(0, 30) || null;
  await query(
    `INSERT INTO stock_sectors (ticker, market, custom) VALUES ($1, $2, $3)
     ON CONFLICT (ticker) DO UPDATE SET custom = EXCLUDED.custom`,
    [ticker, marketOf(form), custom],
  );
  revalidatePath("/weights");
}

// ---- 차트 그림(지지·저항, 낙서). 차트를 다시 그리지 않도록 화면은 새로 고치지 않고, 화면 쪽 상태로 바로 보여 줘요.
const TICKER = /^[A-Z0-9.\-]{1,12}$/;
const positive = (v: number) => Number.isFinite(v) && v > 0;

export async function addLevel(input: { ticker: string; name: string; kind: LevelKind; low: number; high: number | null }): Promise<number | null> {
  const ticker = input.ticker.toUpperCase();
  if (!TICKER.test(ticker) || !(input.kind in KIND_LABEL) || !positive(input.low) || (input.high !== null && !positive(input.high))) return null;
  const [row] = await query<{ id: number }>(
    "INSERT INTO chart_levels (ticker, name, kind, low, high) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [ticker, input.name.slice(0, 60), input.kind, input.low, input.high],
  );
  return row.id;
}

export async function updateLevel(id: number, change: { memo?: string; alert?: boolean; kind?: LevelKind; low?: number; high?: number | null; color?: string | null }): Promise<void> {
  if (change.color !== undefined && validColor(change.color)) await query("UPDATE chart_levels SET color = $2 WHERE id = $1", [id, change.color]);
  // 끌어서 옮긴 가격. 구간이면 위·아래가 같이 와요.
  if (change.low !== undefined && positive(change.low) && (change.high === undefined || change.high === null || positive(change.high))) {
    await query("UPDATE chart_levels SET low = $2, high = CASE WHEN high IS NULL THEN NULL ELSE $3::numeric END, last_price = NULL WHERE id = $1",
      [id, change.low, change.high ?? null]);
  }
  if (change.memo !== undefined) await query("UPDATE chart_levels SET memo = $2 WHERE id = $1", [id, change.memo.slice(0, 100)]);
  // 알림을 새로 켜면 지금 가격부터 다시 봐요(켜자마자 예전 움직임으로 울리지 않게).
  if (change.alert !== undefined) await query("UPDATE chart_levels SET alert = $2, last_price = NULL, alerted_at = NULL WHERE id = $1", [id, change.alert]);
  if (change.kind && change.kind in KIND_LABEL) await query("UPDATE chart_levels SET kind = $2 WHERE id = $1", [id, change.kind]);
}

export async function deleteLevel(id: number): Promise<void> {
  await query("DELETE FROM chart_levels WHERE id = $1", [id]);
}

export async function addDoodle(input: { ticker: string; view: string; color: string; points: DoodlePoint[] }): Promise<number | null> {
  const ticker = input.ticker.toUpperCase();
  if (!TICKER.test(ticker) || !/^[0-9DWM]{1,3}$/.test(input.view) || !/^#[0-9a-f]{6}$/i.test(input.color) || !validDoodle(input.points)) return null;
  const [row] = await query<{ id: number }>(
    "INSERT INTO chart_doodles (ticker, view, color, points) VALUES ($1, $2, $3, $4) RETURNING id",
    [ticker, input.view, input.color, JSON.stringify(input.points)],
  );
  return row.id;
}

export async function deleteDoodle(id: number): Promise<void> {
  await query("DELETE FROM chart_doodles WHERE id = $1", [id]);
}

// 실수 노트를 지금 다시 읽어 달라고 워커에게 남깁니다. 워커가 다음 차례(1분 안팎)에 읽어요.
export async function askMistakes() {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('mistakes_request', to_jsonb($1::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [new Date().toISOString()],
  );
  revalidatePath("/journal/mistakes");
}

// 비교·복기 화면에서 일봉이 없는 종목을 워커에게 받아 달라고 남겨요(이미 남긴 요청과 합쳐서 최대 8개).
export async function askHistory(items: [string, "KR" | "US"][]) {
  const clean = items.filter(([t, m]) => /^[0-9A-Z.\-]{1,12}$/.test(t) && (m === "KR" || m === "US")).slice(0, 8);
  if (clean.length === 0) return;
  const [row] = await query<{ value: { tickers?: [string, string][] } | null }>("SELECT value FROM app_settings WHERE key = 'history_request'").catch(() => []);
  const merged = [...(row?.value?.tickers ?? [])];
  for (const it of clean) if (!merged.some(([t]) => t === it[0])) merged.push(it);
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('history_request', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ tickers: merged.slice(0, 8), at: new Date().toISOString() })],
  );
}
