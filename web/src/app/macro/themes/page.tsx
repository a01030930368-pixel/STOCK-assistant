import { query } from "@/lib/db";
import MacroTabs from "../MacroTabs";
import ThemeView, { type ThemeRow } from "./ThemeView";

export const dynamic = "force-dynamic";

type Row = { code: string; name: string; stocks: number; change_pct: string; week_pct: string | null; rising: number; falling: number; leader: string; updated_at: Date };
type Status = { at: string; ok: boolean; error?: string };

// 워커가 처음 돌기 전의 예전 DB에는 테이블이 없을 수 있어요.
const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);

export default async function ThemesPage() {
  const [rows, mine, status] = await Promise.all([
    safe<Row>("SELECT code, name, stocks, change_pct, week_pct, rising, falling, leader, updated_at FROM theme_index"),
    // 내 종목(보유·ISA)이 든 테마 → 종목 이름들
    safe<{ code: string; names: string[] }>(
      `SELECT s.code, array_agg(DISTINCT h.name) AS names FROM stock_themes s
         JOIN (SELECT ticker, name FROM holdings WHERE quantity > 0 AND market = 'KR'
               UNION SELECT ticker, name FROM isa_holdings WHERE quantity > 0) h ON h.ticker = s.ticker
        GROUP BY s.code`,
    ),
    safe<{ value: Status }>("SELECT value FROM app_settings WHERE key = 'theme_status'").then((r) => r[0]?.value ?? null),
  ]);
  const held = new Map(mine.map((m) => [m.code, m.names]));
  const themes: ThemeRow[] = rows.map((r) => ({
    code: r.code, name: r.name, stocks: r.stocks, today: Number(r.change_pct), week: r.week_pct === null ? null : Number(r.week_pct),
    rising: r.rising, falling: r.falling, leader: r.leader, mine: held.get(r.code) ?? [],
  }));
  const updated = rows.reduce<Date | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null);
  const failed = status && !status.ok && (!updated || new Date(status.at) > updated) ? (status.error ?? "알 수 없는 오류").slice(0, 120) : null;

  return (
    <>
      <div className="board-head">
        <h1>매크로 환경</h1>
        <MacroTabs on="themes" />
      </div>
      <ThemeView themes={themes} updated={updated ? updated.toISOString() : null} error={failed} />
    </>
  );
}
