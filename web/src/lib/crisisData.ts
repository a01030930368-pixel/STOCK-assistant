import { query } from "./db";
import { usdKrw } from "./fx";
import { beta, indexOf, type Account, type Close, type CrisisCash, type CrisisHolding } from "./crisis";

type Row = { ticker: string; name: string; account: Account; quantity: string; cur_price: string; eval_amount: string };

const closes = (rows: { code: string; day: string; close: string }[]) => {
  const out = new Map<string, Close[]>();
  for (const r of rows) {
    const list = out.get(r.code) ?? [];
    list.push({ day: r.day, close: Number(r.close) });
    out.set(r.code, list);
  }
  return out;
};

/** 위기 리허설에 필요한 것: 일반·ISA·미국 보유 종목(베타·손절가·반도체), 예수금, 환율. */
export async function loadCrisis(): Promise<{ holdings: CrisisHolding[]; cash: CrisisCash; rate: number }> {
  const rows = await query<Row>(
    `SELECT ticker, name, market AS account, quantity, cur_price, eval_amount FROM holdings WHERE quantity > 0
     UNION ALL SELECT ticker, name, 'ISA', quantity, cur_price, eval_amount FROM isa_holdings WHERE quantity > 0`,
  ).catch(() => []);
  const rate = await usdKrw();
  const cashRows = await query<{ market: string; v: string }>(
    "SELECT market, COALESCE(d2_deposit, deposit) AS v FROM cash_balances",
  ).catch(() => []);
  const [isaCash] = await query<{ v: string }>("SELECT COALESCE(d2_deposit, deposit) AS v FROM isa_cash WHERE id = 1").catch(() => []);
  const cash: CrisisCash = {
    krw: Number(cashRows.find((c) => c.market === "KR")?.v ?? 0) + Number(isaCash?.v ?? 0),
    usd: Number(cashRows.find((c) => c.market === "US")?.v ?? 0),
  };
  const tickers = rows.map((r) => r.ticker);
  const hist = closes(await query<{ code: string; day: string; close: string }>(
    `SELECT ticker AS code, to_char(day, 'YYYY-MM-DD') AS day, close FROM price_history
     WHERE ticker = ANY($1) AND day >= CURRENT_DATE - 400 ORDER BY day`,
    [tickers],
  ).catch(() => []));
  const index = closes(await query<{ code: string; day: string; close: string }>(
    `SELECT code, to_char(day, 'YYYY-MM-DD') AS day, close FROM sector_daily
     WHERE market = 'MK' AND code IN ('KOSPI', 'NASDAQ') AND day >= CURRENT_DATE - 400 ORDER BY day`,
  ).catch(() => []));
  // 손절가: 켜진 손절 알림 중 가장 높은 값(먼저 닿는 값)
  const stops = new Map((await query<{ ticker: string; price: string }>(
    "SELECT ticker, max(price) AS price FROM alerts WHERE active AND kind = 'stop' GROUP BY ticker",
  ).catch(() => [])).map((r) => [r.ticker, Number(r.price)]));
  const semis = new Set((await query<{ ticker: string }>(
    `SELECT ticker FROM stock_sectors WHERE COALESCE(custom, sector) ~* '반도체|semiconductor'`,
  ).catch(() => [])).map((r) => r.ticker));

  const holdings = rows.map<CrisisHolding>((r) => {
    const us = r.account === "US";
    const evalAmount = Number(r.eval_amount);
    const b = beta(hist.get(r.ticker) ?? [], index.get(indexOf(r.account)) ?? []);
    return {
      ticker: r.ticker, name: r.name, account: r.account, price: Number(r.cur_price),
      value: us ? evalAmount * rate : evalAmount, usd: us ? evalAmount : undefined,
      semi: semis.has(r.ticker) || /반도체|semicon/i.test(r.name),
      stop: stops.get(r.ticker) ?? null, beta: b ?? 1, betaKnown: b !== null,
    };
  });
  return { holdings, cash, rate };
}

/** 과거 위기 구간 일봉(워커가 받아 둔 것) */
export async function loadCrisisSeries(codes: string[]): Promise<Map<string, Close[]>> {
  return closes(await query<{ code: string; day: string; close: string }>(
    `SELECT code, to_char(day, 'YYYY-MM-DD') AS day, close FROM crisis_prices WHERE code = ANY($1) ORDER BY day`,
    [["KOSPI", "NASDAQ", "SPX", "USDKRW", ...codes]],
  ).catch(() => []));
}

export async function crisisPrinciples(): Promise<string[]> {
  return (await query<{ body: string }>("SELECT body FROM principles WHERE kind = 'crisis' ORDER BY sort_order, id").catch(() => [])).map((r) => r.body);
}
