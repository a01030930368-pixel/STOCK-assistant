import Link from "next/link";
import { addWatch, deleteAlert, removeWatch, toggleAlert } from "@/app/actions";
import { query } from "@/lib/db";
import { signClass, usd, won } from "@/lib/format";
import { gapPct, nearest, sparkGeometry, wayLabel, type WatchAlert } from "@/lib/watch";

export const dynamic = "force-dynamic";

type Row = { ticker: string; name: string; market: "KR" | "US"; memo: string; cur: string | null; change_pct: string | null; fetched_at: Date | null };
type AlertRow = { id: number; ticker: string; direction: "above" | "below"; price: string; active: boolean; memo: string; triggered: string | null };
type Fired = { ticker: string; name: string; direction: "above" | "below"; price: string; triggered: string };

// 워커가 처음 돌기 전의 예전 DB에는 관심종목 테이블이 없을 수 있습니다.
const safe = <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params).catch(() => [] as T[]);
const W = 260, H = 64;

export default async function WatchPage() {
  // 현재가: 가진 종목은 잔고 값, 아니면 워커가 받은 현재가, 그것도 없으면 마지막 종가
  const rows = await safe<Row>(
    `SELECT w.ticker, w.name, w.market, w.memo,
       COALESCE(h.cur_price, q.price, (SELECT close FROM price_history p WHERE p.ticker = w.ticker ORDER BY day DESC LIMIT 1)) AS cur,
       q.change_pct, q.fetched_at
     FROM watchlist w
     LEFT JOIN holdings h ON h.ticker = w.ticker AND h.quantity > 0
     LEFT JOIN watch_quotes q ON q.ticker = w.ticker
     ORDER BY w.created_at`,
  );
  const tickers = rows.map((r) => r.ticker);
  const alerts = await safe<AlertRow>(
    `SELECT id, ticker, direction, price, active, memo, to_char(triggered_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS triggered
     FROM alerts WHERE kind = 'custom' AND ticker = ANY($1) ORDER BY price`,
    [tickers],
  );
  const closes = await safe<{ ticker: string; close: string }>(
    `SELECT ticker, close FROM (
       SELECT ticker, close, day, row_number() OVER (PARTITION BY ticker ORDER BY day DESC) AS rn FROM price_history WHERE ticker = ANY($1)
     ) t WHERE rn <= 40 ORDER BY ticker, day`,
    [tickers],
  );
  const fired = await safe<Fired>(
    `SELECT ticker, name, direction, price, to_char(triggered_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS triggered
     FROM alerts WHERE kind = 'custom' AND triggered_at IS NOT NULL ORDER BY triggered_at DESC LIMIT 5`,
  );

  return (
    <>
      <div className="page-head">
        <h1>관심종목</h1>
        <Link href="/compare" className="chip-btn">⇄ 종목 비교</Link>
        <span className="muted">안 가진 종목도 정한 가격에 닿으면 텔레그램으로 알려 드려요. 점선이 목표가예요.</span>
      </div>

      <form action={addWatch} className="panel watch-form">
        <input name="ticker" placeholder="종목코드·티커 (005930, PLTR)" required />
        <input name="name" placeholder="이름" />
        <select name="market" defaultValue="KR">
          <option value="KR">국내</option>
          <option value="US">미국</option>
        </select>
        <input name="price" inputMode="decimal" placeholder="목표가 (선택)" />
        <select name="direction" defaultValue="above">
          <option value="above">위로 가면</option>
          <option value="below">아래로 가면</option>
        </select>
        <input name="memo" placeholder="메모 (선택)" maxLength={200} />
        <button type="submit">+ 추가</button>
      </form>

      {rows.length === 0 ? (
        <p className="muted">아직 관심종목이 없어요. 위에서 종목을 넣으면, 장이 열려 있는 동안 2분마다 현재가를 확인해요.</p>
      ) : (
        <div className="watch-grid">
          {rows.map((r) => {
            const fmt = r.market === "US" ? usd : (v: number | string) => won(v);
            const cur = r.cur === null ? null : Number(r.cur);
            const own: WatchAlert[] = alerts.filter((a) => a.ticker === r.ticker).map((a) => ({
              id: a.id, direction: a.direction, price: Number(a.price), active: a.active, memo: a.memo, triggeredAt: a.triggered,
            }));
            const series = closes.filter((c) => c.ticker === r.ticker).map((c) => Number(c.close));
            if (cur !== null && series.length) series[series.length - 1] = cur;
            const lines = own.filter((a) => a.active).map((a) => a.price);
            const g = series.length > 1 ? sparkGeometry(series, lines, W, H) : null;
            const next = nearest(own, cur);
            const up = series.length > 1 && series[series.length - 1] >= series[0];
            return (
              <div key={r.ticker} className="panel watch-card">
                <div className="watch-head">
                  <Link className="stock-link" href={`/stock/${encodeURIComponent(r.ticker)}`}>{r.name}</Link>
                  <span className="muted code">{r.ticker} · {r.market === "KR" ? "국내" : "미국"}</span>
                </div>
                <div className="watch-price">
                  <span className="num">{cur === null ? "현재가 확인 중" : fmt(cur)}</span>
                  {r.change_pct !== null && (
                    <span className={signClass(r.change_pct)}>{Number(r.change_pct) > 0 ? "+" : ""}{Number(r.change_pct).toFixed(2)}%</span>
                  )}
                </div>
                {g ? (
                  <svg className="watch-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${r.name} 최근 ${series.length}일 흐름`}>
                    {g.lines.map((y, i) => <line key={i} x1="0" x2={W} y1={y} y2={y} className="target" vectorEffect="non-scaling-stroke" />)}
                    <polyline points={g.points} className={up ? "line up" : "line down"} vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : (
                  <div className="watch-spark empty muted">차트는 워커가 일봉을 받으면 보여요</div>
                )}
                <div className="watch-note">
                  {next ? (
                    <>점선 <b className="gold">{fmt(next.price)}</b>에 {wayLabel(next.direction)} 닿으면 알림{cur !== null && <> · {gapPct(cur, next.price) > 0 ? "+" : ""}{gapPct(cur, next.price)}%</>}</>
                  ) : (
                    <span className="muted">켜진 알림이 없어요. 종목 화면 차트에서 가격을 눌러 만들 수 있어요.</span>
                  )}
                </div>
                {r.memo && <div className="muted watch-memo">{r.memo}</div>}
                {own.length > 0 && (
                  <ul className="watch-alerts">
                    {own.map((a) => (
                      <li key={a.id}>
                        <form action={toggleAlert}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="ticker" value={r.ticker} />
                          <button type="submit" className={a.active ? "switch on" : "switch"} aria-pressed={a.active} aria-label={a.active ? "알림 끄기" : "알림 다시 켜기"} />
                        </form>
                        <span className={a.active ? "" : "muted"}>{fmt(a.price)} {wayLabel(a.direction)}</span>
                        <span className="muted">{a.triggeredAt ? `${a.triggeredAt} 울림` : a.memo}</span>
                        <form action={deleteAlert}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="ticker" value={r.ticker} />
                          <button type="submit" className="ghost">삭제</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={removeWatch} className="watch-remove">
                  <input type="hidden" name="ticker" value={r.ticker} />
                  <button type="submit" className="ghost">관심종목에서 빼기</button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      {fired.length > 0 && (
        <>
          <h2>최근 울린 알림</h2>
          <div className="list">
            {fired.map((f, i) => (
              <div key={i} className="list-item">
                <span><span className="muted num">{f.triggered}</span> <b>{f.name}</b> {f.price && won(f.price, 2)} {wayLabel(f.direction)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="muted">한 번 울린 알림은 꺼져요. 스위치를 누르면 다시 켜져요. 국내는 키움, 미국은 야후에서 현재가를 받아요.</p>
    </>
  );
}
