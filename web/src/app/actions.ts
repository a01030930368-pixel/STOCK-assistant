"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool, query } from "@/lib/db";
import { optionalNumber, validateMacro, type MacroInput } from "@/lib/macro";
import { rulesFromForm } from "@/lib/screener";
import { averagePrice, holdingDays, remainingQuantity, returnPct, validateBuy, type BuyInput, type Fill } from "@/lib/journal";

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

export async function createBuy(_prev: FormState, form: FormData): Promise<FormState> {
  const input: BuyInput = {
    tradeDate: text(form, "tradeDate"),
    ticker: text(form, "ticker").toUpperCase(),
    name: text(form, "name"),
    market: text(form, "market") === "US" ? "US" : "KR",
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
  const errors = validateBuy(input);
  if (errors.length) return { errors, values: echo(form) };

  const snapshotId = await snapshotFor(input.tradeDate);
  const client = await pool.connect();
  let positionId: number;
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
         weight_pct, stop_price, target_price, target_basis, macro_snapshot_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [positionId, input.tradeDate, input.quantity, input.price, input.reason, input.scenario, ...input.risks,
        input.weightPct, input.stopPrice, input.targetPrice, input.targetBasis, snapshotId],
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

export async function createSell(_prev: FormState, form: FormData): Promise<FormState> {
  const positionId = num(form, "positionId");
  const tradeDate = text(form, "tradeDate");
  const quantity = num(form, "quantity");
  const price = num(form, "price");
  const reasonType = text(form, "reasonType");
  const lesson = text(form, "lesson");
  const followed = text(form, "followedRules");

  const toFill = (r: { trade_date: string; quantity: string; price: string }): Fill => ({
    tradeDate: r.trade_date, quantity: Number(r.quantity), price: Number(r.price),
  });
  const fills = "to_char(trade_date, 'YYYY-MM-DD') AS trade_date, quantity, price";
  const buys = (await query<{ trade_date: string; quantity: string; price: string }>(
    `SELECT ${fills} FROM buy_entries WHERE position_id = $1`, [positionId])).map(toFill);
  const sells = (await query<{ trade_date: string; quantity: string; price: string }>(
    `SELECT ${fills} FROM sell_entries WHERE position_id = $1`, [positionId])).map(toFill);
  const remaining = remainingQuantity(buys, sells);

  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) errors.push("매도일을 입력하세요.");
  if (!(quantity > 0 && quantity <= remaining)) errors.push(`매도 수량은 0보다 크고 남은 수량(${remaining}) 이하여야 합니다.`);
  if (!(price > 0)) errors.push("매도가를 입력하세요.");
  if (!["stop", "target", "other"].includes(reasonType)) errors.push("매도 이유를 고르세요.");
  if (!lesson) errors.push("배운 것을 적어야 합니다.");
  if (followed !== "yes" && followed !== "no") errors.push("원칙을 지켰는지 고르세요.");
  if (errors.length) return { errors, values: echo(form) };

  const avgBuy = averagePrice(buys);
  await query(
    `INSERT INTO sell_entries (position_id, trade_date, quantity, price, avg_buy_price, return_pct, holding_days,
       reason_type, reason_detail, lesson, followed_rules, macro_snapshot_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [positionId, tradeDate, quantity, price, avgBuy, returnPct(avgBuy, price), holdingDays(buys, tradeDate),
      reasonType, text(form, "reasonDetail"), lesson, followed === "yes", await snapshotFor(tradeDate)],
  );
  if (quantity === remaining) {
    await query("UPDATE positions SET status = 'closed', closed_at = now() WHERE id = $1", [positionId]);
    await query("UPDATE alerts SET active = false WHERE position_id = $1 AND active", [positionId]);
  }
  revalidatePath(`/journal/${positionId}`);
  revalidatePath("/journal");
  return { errors: [] };
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
