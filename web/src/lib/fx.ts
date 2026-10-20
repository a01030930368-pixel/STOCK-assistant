import { query } from "./db";

// 원/달러 환율: 키움 잔고의 환율, 없으면(미국 주식이 없을 때 등) 한국은행 환율. 둘 다 없으면 0.
export async function usdKrw(): Promise<number> {
  const [row] = await query<{ rate: string | null }>(
    `SELECT COALESCE(NULLIF((SELECT exch_rate FROM us_account_summary WHERE id = 1), 0),
       (SELECT value FROM macro_indicators WHERE code = 'usdkrw'), 0) AS rate`,
  ).catch(() => []);
  return Number(row?.rate ?? 0);
}
