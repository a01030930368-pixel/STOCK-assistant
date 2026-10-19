from decimal import Decimal

import psycopg

from .alerts import Alert
from .calendar import Event
from .kiwoom import Balance, Cash, UsBalance
from .macro import Indicator
from .research import Earnings, Financials, News


# 이미 만들어진 DB에도 새 테이블이 생기도록 시작할 때 실행합니다. db/schema.sql과 같아야 합니다.
MIGRATIONS = [
    """CREATE TABLE IF NOT EXISTS us_account_summary (
      id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      total_buy      NUMERIC(20, 4) NOT NULL,
      total_eval     NUMERIC(20, 4) NOT NULL,
      total_pnl      NUMERIC(20, 4) NOT NULL,
      total_pnl_pct  NUMERIC(8, 2) NOT NULL,
      exch_rate      NUMERIC(12, 4) NOT NULL,
      synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS macro_indicators (
      code        TEXT PRIMARY KEY,
      value       NUMERIC(12, 4) NOT NULL,
      as_of       TEXT NOT NULL,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "ALTER TABLE macro_snapshots ADD COLUMN IF NOT EXISTS us_inflation NUMERIC(5, 2)",
    """CREATE TABLE IF NOT EXISTS stock_news (
      ticker        TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT NOT NULL,
      source        TEXT NOT NULL,
      published_at  TIMESTAMPTZ NOT NULL,
      summary       TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (ticker, url)
    )""",
    "ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS title_ko TEXT",
    """CREATE TABLE IF NOT EXISTS stock_earnings (
      ticker        TEXT NOT NULL,
      period        TEXT NOT NULL,
      title         TEXT NOT NULL,
      url           TEXT NOT NULL,
      reported_on   DATE,
      eps_actual    NUMERIC(14, 4),
      eps_estimate  NUMERIC(14, 4),
      PRIMARY KEY (ticker, url, title)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_financials (
      ticker               TEXT NOT NULL,
      period               TEXT NOT NULL,
      revenue              NUMERIC(24, 2),
      operating_income     NUMERIC(24, 2),
      liabilities          NUMERIC(24, 2),
      equity               NUMERIC(24, 2),
      operating_cash_flow  NUMERIC(24, 2),
      fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ticker, period)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_peers (
      ticker       TEXT NOT NULL,
      peer_ticker  TEXT NOT NULL,
      peer_name    TEXT NOT NULL,
      peer_market  TEXT NOT NULL CHECK (peer_market IN ('KR', 'US')),
      PRIMARY KEY (ticker, peer_ticker)
    )""",
    """CREATE TABLE IF NOT EXISTS cash_balances (
      market      TEXT PRIMARY KEY CHECK (market IN ('KR', 'US')),
      currency    TEXT NOT NULL,
      deposit     NUMERIC(20, 4) NOT NULL,
      d2_deposit  NUMERIC(20, 4),
      orderable   NUMERIC(20, 4),
      synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS calendar_events (
      day     DATE NOT NULL,
      kind    TEXT NOT NULL CHECK (kind IN ('holiday', 'earnings')),
      market  TEXT NOT NULL CHECK (market IN ('KR', 'US')),
      ticker  TEXT NOT NULL DEFAULT '',
      title   TEXT NOT NULL,
      detail  TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (day, kind, market, ticker, title)
    )""",
    """CREATE TABLE IF NOT EXISTS price_history (
      ticker  TEXT NOT NULL,
      day     DATE NOT NULL,
      close   NUMERIC(18, 4) NOT NULL,
      PRIMARY KEY (ticker, day)
    )""",
    # 캔들·거래량 차트용. 예전 DB에는 종가만 있었습니다.
    "ALTER TABLE price_history ADD COLUMN IF NOT EXISTS open NUMERIC(18, 4)",
    "ALTER TABLE price_history ADD COLUMN IF NOT EXISTS high NUMERIC(18, 4)",
    "ALTER TABLE price_history ADD COLUMN IF NOT EXISTS low NUMERIC(18, 4)",
    "ALTER TABLE price_history ADD COLUMN IF NOT EXISTS volume NUMERIC(20, 0)",
    """CREATE TABLE IF NOT EXISTS chart_memos (
      id          SERIAL PRIMARY KEY,
      ticker      TEXT NOT NULL,
      day         DATE NOT NULL,
      body        TEXT NOT NULL CHECK (length(trim(body)) > 0),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS screener_stocks (
      ticker         TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      market         TEXT NOT NULL,
      day            DATE NOT NULL,
      price          NUMERIC(18, 4) NOT NULL,
      change_pct     NUMERIC(10, 2),
      trade_value    NUMERIC(22, 0) NOT NULL,
      volume_ratio   NUMERIC(10, 2),
      rsi14          NUMERIC(6, 2),
      ma5            NUMERIC(18, 4),
      ma20           NUMERIC(18, 4),
      ma20_gap_pct   NUMERIC(10, 2),
      golden_cross   BOOLEAN NOT NULL DEFAULT false,
      high_52w       NUMERIC(18, 4) NOT NULL,
      near_high_pct  NUMERIC(10, 2) NOT NULL,
      spark          NUMERIC[] NOT NULL DEFAULT '{}',
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    # 처음 만들 때만 기본 조건 4개를 넣습니다. 사용자가 지운 뒤 다시 생기지 않게 테이블이 없을 때만 실행합니다.
    """DO $$ BEGIN
      IF to_regclass('public.screener_presets') IS NULL THEN
        CREATE TABLE screener_presets (
          id          SERIAL PRIMARY KEY,
          name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
          rules       JSONB NOT NULL DEFAULT '{}',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        INSERT INTO screener_presets (name, rules) VALUES
          ('거래대금 터진 종목', '{"minValueEok": 1500, "volRatioMin": 1.5, "chgMin": -5, "chgMax": 10}'),
          ('눌림목', '{"rsiMax": 35, "ma20": "below"}'),
          ('신고가 근접', '{"nearHighPct": 5}'),
          ('골든크로스', '{"goldenCross": true}');
      END IF;
    END $$""",
]
def migrate(conn: psycopg.Connection) -> None:
    for statement in MIGRATIONS:
        conn.execute(statement)


def save_balance(conn: psycopg.Connection, balance: Balance) -> None:
    with conn.transaction():
        conn.execute("DELETE FROM holdings WHERE market = 'KR'")
        for h in balance.holdings:
            conn.execute(
                """INSERT INTO holdings (ticker, name, market, quantity, avg_price, cur_price, eval_amount, pnl, pnl_pct)
                   VALUES (%s, %s, 'KR', %s, %s, %s, %s, %s, %s)""",
                (h.ticker, h.name, h.quantity, h.avg_price, h.cur_price, h.eval_amount, h.pnl, h.pnl_pct),
            )
        conn.execute(
            """INSERT INTO account_summary (id, total_buy, total_eval, total_pnl, total_pnl_pct, est_deposit, synced_at)
               VALUES (1, %s, %s, %s, %s, %s, now())
               ON CONFLICT (id) DO UPDATE SET total_buy = EXCLUDED.total_buy, total_eval = EXCLUDED.total_eval,
                 total_pnl = EXCLUDED.total_pnl, total_pnl_pct = EXCLUDED.total_pnl_pct,
                 est_deposit = EXCLUDED.est_deposit, synced_at = now()""",
            (balance.total_buy, balance.total_eval, balance.total_pnl, balance.total_pnl_pct, balance.est_deposit),
        )


def save_us_balance(conn: psycopg.Connection, balance: UsBalance) -> None:
    with conn.transaction():
        conn.execute("DELETE FROM holdings WHERE market = 'US'")
        for h in balance.holdings:
            conn.execute(
                """INSERT INTO holdings (ticker, name, market, quantity, avg_price, cur_price, eval_amount, pnl, pnl_pct)
                   VALUES (%s, %s, 'US', %s, %s, %s, %s, %s, %s)""",
                (h.ticker, h.name, h.quantity, h.avg_price, h.cur_price, h.eval_amount, h.pnl, h.pnl_pct),
            )
        conn.execute(
            """INSERT INTO us_account_summary (id, total_buy, total_eval, total_pnl, total_pnl_pct, exch_rate, synced_at)
               VALUES (1, %s, %s, %s, %s, %s, now())
               ON CONFLICT (id) DO UPDATE SET total_buy = EXCLUDED.total_buy, total_eval = EXCLUDED.total_eval,
                 total_pnl = EXCLUDED.total_pnl, total_pnl_pct = EXCLUDED.total_pnl_pct,
                 exch_rate = EXCLUDED.exch_rate, synced_at = now()""",
            (balance.total_buy, balance.total_eval, balance.total_pnl, balance.total_pnl_pct, balance.exch_rate),
        )


def save_cash(conn: psycopg.Connection, market: str, cash: Cash) -> None:
    conn.execute(
        """INSERT INTO cash_balances (market, currency, deposit, d2_deposit, orderable, synced_at)
           VALUES (%s, %s, %s, %s, %s, now())
           ON CONFLICT (market) DO UPDATE SET currency = EXCLUDED.currency, deposit = EXCLUDED.deposit,
             d2_deposit = EXCLUDED.d2_deposit, orderable = EXCLUDED.orderable, synced_at = now()""",
        (market, cash.currency, cash.deposit, cash.d2_deposit, cash.orderable),
    )


def save_indicators(conn: psycopg.Connection, indicators: list[Indicator]) -> None:
    for i in indicators:
        conn.execute(
            """INSERT INTO macro_indicators (code, value, as_of, fetched_at) VALUES (%s, %s, %s, now())
               ON CONFLICT (code) DO UPDATE SET value = EXCLUDED.value, as_of = EXCLUDED.as_of, fetched_at = now()""",
            (i.code, i.value, i.as_of),
        )


def watched_stocks(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    """뉴스·실적·재무를 모을 종목: 보유 종목과 매매일지에서 보유 중인 종목. (ticker, name, market)"""
    return conn.execute(
        """SELECT ticker, name, market FROM holdings
           UNION SELECT ticker, name, market FROM positions WHERE status = 'open'
           ORDER BY ticker"""
    ).fetchall()


def peer_stocks(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    """업종 비교용으로 지정한 비교 기업. 재무만 모읍니다."""
    return conn.execute("SELECT DISTINCT peer_ticker, peer_name, peer_market FROM stock_peers ORDER BY 1").fetchall()


def save_news(conn: psycopg.Connection, items: list[News]) -> None:
    for n in items:
        conn.execute(
            """INSERT INTO stock_news (ticker, url, title, source, published_at, summary) VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, url) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
                 title_ko = CASE WHEN stock_news.title = EXCLUDED.title THEN stock_news.title_ko END""",
            (n.ticker, n.url, n.title, n.source, n.published_at, n.summary),
        )
    conn.execute("DELETE FROM stock_news WHERE published_at < now() - interval '60 days'")


def untranslated_news(conn: psycopg.Connection, limit: int = 40) -> list[tuple[str, str, str]]:
    """아직 한국어 제목이 없는 최근 뉴스. (ticker, url, title)"""
    return conn.execute(
        """SELECT ticker, url, title FROM stock_news WHERE title_ko IS NULL
           ORDER BY published_at DESC LIMIT %s""",
        (limit,),
    ).fetchall()


def save_title_ko(conn: psycopg.Connection, ticker: str, url: str, title_ko: str) -> None:
    conn.execute("UPDATE stock_news SET title_ko = %s WHERE ticker = %s AND url = %s", (title_ko, ticker, url))


def save_earnings(conn: psycopg.Connection, ticker: str, items: list[Earnings]) -> None:
    with conn.transaction():
        conn.execute("DELETE FROM stock_earnings WHERE ticker = %s", (ticker,))
        for e in items:
            conn.execute(
                """INSERT INTO stock_earnings (ticker, period, title, url, reported_on, eps_actual, eps_estimate)
                   VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                (e.ticker, e.period, e.title, e.url, e.reported_on, e.eps_actual, e.eps_estimate),
            )


def save_financials(conn: psycopg.Connection, items: list[Financials]) -> None:
    for f in items:
        conn.execute(
            """INSERT INTO stock_financials (ticker, period, revenue, operating_income, liabilities, equity, operating_cash_flow, fetched_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (ticker, period) DO UPDATE SET revenue = EXCLUDED.revenue, operating_income = EXCLUDED.operating_income,
                 liabilities = EXCLUDED.liabilities, equity = EXCLUDED.equity,
                 operating_cash_flow = EXCLUDED.operating_cash_flow, fetched_at = now()""",
            (f.ticker, f.period, f.revenue, f.operating_income, f.liabilities, f.equity, f.operating_cash_flow),
        )


def current_prices(conn: psycopg.Connection) -> dict[str, Decimal]:
    return {row[0]: row[1] for row in conn.execute("SELECT ticker, cur_price FROM holdings")}


def active_alerts(conn: psycopg.Connection) -> list[Alert]:
    rows = conn.execute("SELECT id, ticker, name, kind, direction, price FROM alerts WHERE active").fetchall()
    return [Alert(*row) for row in rows]


def mark_triggered(conn: psycopg.Connection, alert_id: int) -> None:
    conn.execute("UPDATE alerts SET active = false, triggered_at = now() WHERE id = %s", (alert_id,))


def save_calendar(conn: psycopg.Connection, kind: str, events: list[Event], ticker: str | None = None) -> None:
    """앞으로의 일정을 새로 받은 것으로 바꿉니다. 실적은 종목별로, 휴장일은 한 번에 바꿉니다."""
    with conn.transaction():
        if ticker is None:
            conn.execute("DELETE FROM calendar_events WHERE kind = %s AND day >= CURRENT_DATE", (kind,))
        else:
            conn.execute("DELETE FROM calendar_events WHERE kind = %s AND ticker = %s AND day >= CURRENT_DATE", (kind, ticker))
        for e in events:
            conn.execute(
                """INSERT INTO calendar_events (day, kind, market, ticker, title, detail) VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                (e.day, e.kind, e.market, e.ticker, e.title, e.detail),
            )
        conn.execute("DELETE FROM calendar_events WHERE day < CURRENT_DATE - 30")


def save_prices(conn: psycopg.Connection, ticker: str, rows) -> None:
    for r in rows:
        conn.execute(
            """INSERT INTO price_history (ticker, day, open, high, low, close, volume) VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, day) DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                 close = EXCLUDED.close, volume = EXCLUDED.volume""",
            (ticker, r.day, r.open, r.high, r.low, r.close, r.volume),
        )


def snapshot_prices(conn: psycopg.Connection) -> None:
    """보유 종목 현재가를 그 시장의 오늘 날짜 종가로 적어 둡니다. 장 마감 뒤 마지막 값이 그날 종가가 됩니다.

    고가·저가는 지금까지 본 값으로 넓히고, 일봉을 받아 오면 정확한 값으로 덮어씁니다."""
    conn.execute(
        """INSERT INTO price_history (ticker, day, open, high, low, close)
           SELECT ticker, (now() AT TIME ZONE CASE market WHEN 'KR' THEN 'Asia/Seoul' ELSE 'America/New_York' END)::date,
             cur_price, cur_price, cur_price, cur_price
           FROM holdings WHERE cur_price > 0
           ON CONFLICT (ticker, day) DO UPDATE SET close = EXCLUDED.close,
             open = COALESCE(price_history.open, EXCLUDED.close),
             high = GREATEST(COALESCE(price_history.high, EXCLUDED.close), EXCLUDED.close),
             low = LEAST(COALESCE(price_history.low, EXCLUDED.close), EXCLUDED.close)"""
    )


def save_screener(conn: psycopg.Connection, market: str, rows) -> None:
    """이번에 계산한 종목으로 그 시장 목록을 통째로 바꿉니다. 순위에서 빠진 종목은 사라집니다."""
    from .screener import dec

    with conn.transaction():
        conn.execute("DELETE FROM screener_stocks WHERE market = %s", (market,))
        for m in rows:
            conn.execute(
                """INSERT INTO screener_stocks (ticker, name, market, day, price, change_pct, trade_value, volume_ratio,
                     rsi14, ma5, ma20, ma20_gap_pct, golden_cross, high_52w, near_high_pct, spark)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (ticker) DO NOTHING""",
                (m.ticker, m.name, market, m.day, dec(m.price, 4), dec(m.change_pct), dec(m.trade_value, 0),
                 dec(m.volume_ratio), dec(m.rsi14), dec(m.ma5, 4), dec(m.ma20, 4), dec(m.ma20_gap_pct), m.golden_cross,
                 dec(m.high_52w, 4), dec(m.near_high_pct), [dec(v, 4) for v in m.spark]),
            )
