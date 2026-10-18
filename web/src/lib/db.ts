import { Pool } from "pg";

const globalForPool = globalThis as unknown as { pool?: Pool };

export const pool = globalForPool.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
globalForPool.pool = pool;

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
