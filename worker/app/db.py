from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

from .alerts import Alert
from .levels import Level
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
    "ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS summary_ko TEXT",
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
      kind    TEXT NOT NULL CHECK (kind IN ('holiday', 'earnings', 'policy', 'economic', 'dividend')),
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
    """CREATE TABLE IF NOT EXISTS minute_bars (
      ticker  TEXT NOT NULL,
      ts      TIMESTAMPTZ NOT NULL,
      open    NUMERIC(18, 4) NOT NULL,
      high    NUMERIC(18, 4) NOT NULL,
      low     NUMERIC(18, 4) NOT NULL,
      close   NUMERIC(18, 4) NOT NULL,
      volume  NUMERIC(20, 0) NOT NULL DEFAULT 0,
      PRIMARY KEY (ticker, ts)
    )""",
    """CREATE TABLE IF NOT EXISTS ai_comments (
      ticker      TEXT NOT NULL,
      day         DATE NOT NULL,
      tone        TEXT NOT NULL,
      body        TEXT NOT NULL,
      model       TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ticker, day)
    )""",
    """CREATE TABLE IF NOT EXISTS notices_sent (
      key      TEXT PRIMARY KEY,
      sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    # 금리 결정·만기일(policy)과 미국 경제지표 발표일(economic)을 일정에 넣을 수 있게 합니다.
    "ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_kind_check",
    """ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_kind_check
       CHECK (kind IN ('holiday', 'earnings', 'policy', 'economic', 'dividend'))""",
    """CREATE TABLE IF NOT EXISTS watchlist (
      ticker      TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
      memo        TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS watch_quotes (
      ticker      TEXT PRIMARY KEY,
      price       NUMERIC(18, 4) NOT NULL,
      change_pct  NUMERIC(8, 2),
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS memo TEXT NOT NULL DEFAULT ''",
    """CREATE TABLE IF NOT EXISTS stock_sectors (
      ticker      TEXT PRIMARY KEY,
      market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
      sector      TEXT NOT NULL DEFAULT '',
      custom      TEXT,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS stock_dividends (
      ticker   TEXT NOT NULL,
      ex_date  DATE NOT NULL,
      amount   NUMERIC(18, 4) NOT NULL,
      PRIMARY KEY (ticker, ex_date)
    )""",
    """CREATE TABLE IF NOT EXISTS app_settings (
      key    TEXT PRIMARY KEY,
      value  JSONB NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS trade_fills (
      fill_key    TEXT PRIMARY KEY,
      market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
      trade_date  DATE NOT NULL,
      ticker      TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      side        TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      quantity    NUMERIC(18, 4) NOT NULL,
      price       NUMERIC(18, 4) NOT NULL,
      fee         NUMERIC(18, 4),
      fill_time   TEXT,
      fill_count  INT NOT NULL DEFAULT 1,
      source      TEXT NOT NULL,
      hidden      BOOLEAN NOT NULL DEFAULT false,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "ALTER TABLE buy_entries ADD COLUMN IF NOT EXISTS fill_key TEXT",
    "ALTER TABLE sell_entries ADD COLUMN IF NOT EXISTS fill_key TEXT",
    """CREATE TABLE IF NOT EXISTS book_reviews (
      book_key        TEXT PRIMARY KEY,
      stars           INT CHECK (stars BETWEEN 1 AND 5),
      followed_rules  BOOLEAN,
      thesis          TEXT NOT NULL DEFAULT '',
      plan            TEXT NOT NULL DEFAULT '',
      exit_timing     TEXT NOT NULL DEFAULT '',
      lesson          TEXT NOT NULL DEFAULT '',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS book_key TEXT",
    """CREATE TABLE IF NOT EXISTS asset_history (
      day    DATE PRIMARY KEY,
      total  NUMERIC(20, 2) NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS chart_levels (
      id          SERIAL PRIMARY KEY,
      ticker      TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL CHECK (kind IN ('support', 'resistance')),
      low         NUMERIC(18, 4) NOT NULL,
      high        NUMERIC(18, 4),
      memo        TEXT NOT NULL DEFAULT '',
      alert       BOOLEAN NOT NULL DEFAULT false,
      last_price  NUMERIC(18, 4),
      alerted_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS chart_levels_ticker_idx ON chart_levels (ticker)",
    "ALTER TABLE chart_levels ADD COLUMN IF NOT EXISTS color TEXT",
    """CREATE TABLE IF NOT EXISTS chart_doodles (
      id          SERIAL PRIMARY KEY,
      ticker      TEXT NOT NULL,
      view        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#c9a96b',
      points      JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS chart_doodles_ticker_idx ON chart_doodles (ticker, view)",
    # 날짜 계산(CURRENT_DATE)을 한국 날짜로. 새벽 0~9시에 날짜가 하루 밀리던 문제를 막습니다.
    """DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Seoul'); END $$""",
    # 키움 기록보다 먼저 산 주식을 팔면 평단을 몰라요. 0%로 두면 통계에서 손실로 세서 비워 둡니다.
    "ALTER TABLE sell_entries ALTER COLUMN avg_buy_price DROP NOT NULL",
    "ALTER TABLE sell_entries ALTER COLUMN return_pct DROP NOT NULL",
    """UPDATE sell_entries s SET avg_buy_price = NULL, return_pct = NULL FROM positions p
       WHERE p.id = s.position_id AND p.book_key IS NOT NULL AND s.return_pct = 0 AND s.avg_buy_price = s.price""",
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
                 exch_rate = COALESCE(NULLIF(EXCLUDED.exch_rate, 0), NULLIF(us_account_summary.exch_rate, 0), 0),
                 synced_at = now()""",
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
    """뉴스·실적·재무·차트를 모을 종목: 보유 종목, 매매일지에서 보유 중인 종목, 관심종목. (ticker, name, market)"""
    return conn.execute(
        """SELECT ticker, name, market FROM holdings
           UNION SELECT ticker, name, market FROM positions WHERE status = 'open'
           UNION SELECT ticker, name, market FROM watchlist
           ORDER BY ticker"""
    ).fetchall()


def unpriced_stocks(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    """일봉이 하나도 없는 관심종목. (ticker, name, market)"""
    return conn.execute(
        """SELECT w.ticker, w.name, w.market FROM watchlist w
           WHERE NOT EXISTS (SELECT 1 FROM price_history p WHERE p.ticker = w.ticker) ORDER BY w.ticker"""
    ).fetchall()


def peer_stocks(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    """업종 비교용으로 지정한 비교 기업. 재무만 모읍니다."""
    return conn.execute("SELECT DISTINCT peer_ticker, peer_name, peer_market FROM stock_peers ORDER BY 1").fetchall()


def save_news(conn: psycopg.Connection, items: list[News]) -> None:
    for n in items:
        conn.execute(
            """INSERT INTO stock_news (ticker, url, title, source, published_at, summary) VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, url) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
                 title_ko = CASE WHEN stock_news.title = EXCLUDED.title THEN stock_news.title_ko END,
                 summary_ko = CASE WHEN stock_news.summary = EXCLUDED.summary THEN stock_news.summary_ko END""",
            (n.ticker, n.url, n.title, n.source, n.published_at, n.summary),
        )
    conn.execute("DELETE FROM stock_news WHERE published_at < now() - interval '60 days'")


def untranslated_news(conn: psycopg.Connection, limit: int = 40) -> list[tuple[str, str, str, str | None, str, str | None]]:
    """제목이나 요약에 아직 한국어가 없는 최근 뉴스. (ticker, url, title, title_ko, summary, summary_ko)"""
    return conn.execute(
        """SELECT ticker, url, title, title_ko, summary, summary_ko FROM stock_news
           WHERE title_ko IS NULL OR (summary <> '' AND summary_ko IS NULL)
           ORDER BY published_at DESC LIMIT %s""",
        (limit,),
    ).fetchall()


def save_korean(conn: psycopg.Connection, ticker: str, url: str, title_ko: str, summary_ko: str | None) -> None:
    conn.execute(
        "UPDATE stock_news SET title_ko = %s, summary_ko = %s WHERE ticker = %s AND url = %s",
        (title_ko, summary_ko, ticker, url),
    )


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
    """알림 확인용 현재가. 보유 종목은 잔고 값, 관심종목은 30분 안에 받은 현재가."""
    prices = {row[0]: row[1] for row in conn.execute(
        "SELECT ticker, price FROM watch_quotes WHERE fetched_at > now() - interval '30 minutes' AND price > 0")}
    prices.update({row[0]: row[1] for row in conn.execute("SELECT ticker, cur_price FROM holdings WHERE cur_price > 0")})
    return prices


def watch_targets(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    """현재가를 따로 받아야 하는 관심종목: 잔고에 없는 것만. (ticker, name, market)"""
    return conn.execute(
        """SELECT w.ticker, w.name, w.market FROM watchlist w
           WHERE NOT EXISTS (SELECT 1 FROM holdings h WHERE h.ticker = w.ticker AND h.quantity > 0)
           ORDER BY w.ticker"""
    ).fetchall()


def save_quote(conn: psycopg.Connection, quote) -> None:
    conn.execute(
        """INSERT INTO watch_quotes (ticker, price, change_pct) VALUES (%s, %s, %s)
           ON CONFLICT (ticker) DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct, fetched_at = now()""",
        (quote.ticker, quote.price, quote.change_pct),
    )


def sector_due(conn: psycopg.Connection, max_age_days: int = 7) -> list[tuple[str, str, str]]:
    """업종 이름을 새로 받아야 하는 보유·관심 종목. (ticker, name, market)"""
    return conn.execute(
        """SELECT s.ticker, s.name, s.market FROM (
             SELECT ticker, name, market FROM holdings WHERE quantity > 0
             UNION SELECT ticker, name, market FROM watchlist) s
           LEFT JOIN stock_sectors x ON x.ticker = s.ticker
           WHERE x.ticker IS NULL OR x.sector = '' OR x.fetched_at < now() - make_interval(days => %s)
           ORDER BY s.ticker""",
        (max_age_days,),
    ).fetchall()


def save_sector(conn: psycopg.Connection, ticker: str, market: str, sector: str) -> None:
    # 직접 고친 업종(custom)은 건드리지 않습니다.
    conn.execute(
        """INSERT INTO stock_sectors (ticker, market, sector) VALUES (%s, %s, %s)
           ON CONFLICT (ticker) DO UPDATE SET sector = EXCLUDED.sector, fetched_at = now()""",
        (ticker, market, sector),
    )


def active_alerts(conn: psycopg.Connection) -> list[Alert]:
    rows = conn.execute("SELECT id, ticker, name, kind, direction, price FROM alerts WHERE active").fetchall()
    return [Alert(*row) for row in rows]


def chart_levels(conn: psycopg.Connection) -> list[Level]:
    rows = conn.execute(
        "SELECT id, ticker, name, kind, low, high, memo, alert, last_price, alerted_at FROM chart_levels ORDER BY id").fetchall()
    return [Level(*r) for r in rows]


def save_level_seen(conn: psycopg.Connection, level_id: int, price: Decimal, alerted: bool) -> None:
    conn.execute(
        "UPDATE chart_levels SET last_price = %s, alerted_at = CASE WHEN %s THEN now() ELSE alerted_at END WHERE id = %s",
        (price, alerted, level_id),
    )


def close_sold_positions(conn: psycopg.Connection, market: str) -> list[int]:
    """키움에서 다 판 종목의 '보유 중' 일지를 끝난 것으로 바꾸고 손절·익절 알림을 끕니다.

    잔고에 없고, 마지막 매수 일지 날 이후 매도 체결이 있는 것만요(일지를 먼저 쓰고 아직 안 산 경우는 그대로 둡니다)."""
    with conn.transaction():
        ids = [r[0] for r in conn.execute(
            """UPDATE positions p SET status = 'closed', closed_at = now()
               WHERE p.status = 'open' AND p.market = %s
                 AND NOT EXISTS (SELECT 1 FROM holdings h WHERE h.ticker = p.ticker AND h.market = p.market AND h.quantity > 0)
                 AND EXISTS (SELECT 1 FROM trade_fills f WHERE f.ticker = p.ticker AND f.market = p.market AND f.side = 'sell'
                   AND f.trade_date >= COALESCE((SELECT max(trade_date) FROM buy_entries b WHERE b.position_id = p.id), p.created_at::date))
               RETURNING p.id""",
            (market,),
        ).fetchall()]
        if ids:
            conn.execute("UPDATE alerts SET active = false WHERE position_id = ANY(%s) AND kind IN ('stop', 'target') AND active", (ids,))
    return ids


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


def balance_synced(conn: psycopg.Connection) -> bool:
    return conn.execute(
        "SELECT EXISTS (SELECT 1 FROM account_summary) OR EXISTS (SELECT 1 FROM us_account_summary)").fetchone()[0]


def prune_calendar(conn: psycopg.Connection) -> None:
    """팔았거나 관심종목에서 뺀 종목의 앞으로 일정은 지웁니다. 실적은 지켜보는 종목, 배당은 들고 있는 종목만 남겨요."""
    conn.execute(
        """DELETE FROM calendar_events c WHERE c.kind = 'earnings' AND c.day >= CURRENT_DATE AND c.ticker IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM holdings h WHERE h.ticker = c.ticker)
             AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.ticker = c.ticker AND p.status = 'open')
             AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.ticker = c.ticker)"""
    )
    conn.execute(
        """DELETE FROM calendar_events c WHERE c.kind = 'dividend' AND c.day >= CURRENT_DATE AND c.ticker IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM holdings h WHERE h.ticker = c.ticker AND h.quantity > 0)"""
    )


def held_quantities(conn: psycopg.Connection) -> list[tuple[str, str, str, Decimal]]:
    """(ticker, name, market, quantity)"""
    return conn.execute("SELECT ticker, name, market, quantity FROM holdings WHERE quantity > 0 ORDER BY ticker").fetchall()


def save_dividends(conn: psycopg.Connection, ticker: str, rows) -> None:
    for d in rows:
        conn.execute(
            """INSERT INTO stock_dividends (ticker, ex_date, amount) VALUES (%s, %s, %s)
               ON CONFLICT (ticker, ex_date) DO UPDATE SET amount = EXCLUDED.amount""",
            (ticker, d.ex_date, d.amount),
        )


def save_prices(conn: psycopg.Connection, ticker: str, rows) -> None:
    for r in rows:
        conn.execute(
            """INSERT INTO price_history (ticker, day, open, high, low, close, volume) VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, day) DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                 close = EXCLUDED.close, volume = EXCLUDED.volume""",
            (ticker, r.day, r.open, r.high, r.low, r.close, r.volume),
        )


def snapshot_prices(conn: psycopg.Connection, markets: list[str]) -> None:
    """보유 종목 현재가를 그 시장의 오늘 날짜 종가로 적어 둡니다. 장 마감 뒤 마지막 값이 그날 종가가 됩니다.

    정규장이 열린 시장(markets)만 적습니다. 주말·장 전에 켜도 가짜 일봉이 생기지 않아요.
    고가·저가는 지금까지 본 값으로 넓히고, 일봉을 받아 오면 정확한 값으로 덮어씁니다."""
    if not markets:
        return
    conn.execute(
        """INSERT INTO price_history (ticker, day, open, high, low, close)
           SELECT ticker, (now() AT TIME ZONE CASE market WHEN 'KR' THEN 'Asia/Seoul' ELSE 'America/New_York' END)::date,
             cur_price, cur_price, cur_price, cur_price
           FROM holdings WHERE cur_price > 0 AND market = ANY(%s)
           ON CONFLICT (ticker, day) DO UPDATE SET close = EXCLUDED.close,
             open = COALESCE(price_history.open, EXCLUDED.close),
             high = GREATEST(COALESCE(price_history.high, EXCLUDED.close), EXCLUDED.close),
             low = LEAST(COALESCE(price_history.low, EXCLUDED.close), EXCLUDED.close)""",
        (markets,),
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


def save_minutes(conn: psycopg.Connection, ticker: str, bars, keep_days: int = 8) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO minute_bars (ticker, ts, open, high, low, close, volume) VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, ts) DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                 close = EXCLUDED.close, volume = EXCLUDED.volume""",
            [(ticker, b.ts, b.open, b.high, b.low, b.close, b.volume) for b in bars],
        )
    conn.execute("DELETE FROM minute_bars WHERE ticker = %s AND ts < now() - make_interval(days => %s)", (ticker, keep_days))
    # 예전에 초가 붙은 채 저장된 진행 중 봉을 지웁니다. 같은 분의 완성된 봉이 따로 있습니다.
    conn.execute("DELETE FROM minute_bars WHERE ticker = %s AND extract(second FROM ts) <> 0", (ticker,))


def held_stocks(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    return conn.execute("SELECT ticker, name, market FROM holdings WHERE quantity > 0 ORDER BY ticker").fetchall()


def ai_comment_days(conn: psycopg.Connection) -> dict[str, object]:
    """종목별 마지막 AI 한마디 날짜."""
    return dict(conn.execute("SELECT ticker, max(day) FROM ai_comments GROUP BY ticker").fetchall())


def save_ai_comment(conn: psycopg.Connection, ticker: str, day, tone: str, body: str, model: str) -> None:
    conn.execute(
        """INSERT INTO ai_comments (ticker, day, tone, body, model) VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (ticker, day) DO UPDATE SET tone = EXCLUDED.tone, body = EXCLUDED.body, model = EXCLUDED.model, created_at = now()""",
        (ticker, day, tone, body, model),
    )
    conn.execute("DELETE FROM ai_comments WHERE ticker = %s AND day < CURRENT_DATE - 60", (ticker,))


def _plain(v) -> str:
    # Decimal('40.0000') -> '40', 지수 표기(4E+1) 없이
    return format(v.normalize(), "f")


def ai_context(conn: psycopg.Connection, ticker: str, name: str, market: str) -> dict:
    """AI 한마디에 넣을 자료. 없는 항목은 빼고 보냅니다."""
    from .screener import rsi

    ctx: dict = {"ticker": ticker, "name": name, "market": market}
    h = conn.execute("SELECT quantity, avg_price, cur_price, pnl_pct FROM holdings WHERE ticker = %s", (ticker,)).fetchone()
    if h:
        ctx["holding"] = {"quantity": _plain(h[0]), "avg_price": _plain(h[1]), "cur_price": _plain(h[2]), "pnl_pct": h[3]}
    j = conn.execute(
        """SELECT b.reason, b.scenario, b.risk_1, b.risk_2, b.risk_3, b.stop_price, b.target_price
           FROM buy_entries b JOIN positions p ON p.id = b.position_id
           WHERE p.ticker = %s AND p.status = 'open' ORDER BY b.trade_date DESC, b.id DESC LIMIT 1""",
        (ticker,),
    ).fetchone()
    if j:
        ctx["journal"] = {"reason": j[0], "scenario": j[1], "risks": [j[2], j[3], j[4]],
                          "stop_price": _plain(j[5]), "target_price": _plain(j[6])}
    closes = [float(r[0]) for r in conn.execute(
        "SELECT close FROM (SELECT day, close FROM price_history WHERE ticker = %s ORDER BY day DESC LIMIT 250) t ORDER BY day", (ticker,)
    ).fetchall()]
    if len(closes) >= 2:
        last = closes[-1]
        ma20 = sum(closes[-20:]) / len(closes[-20:])
        r = rsi(closes)
        ctx["price"] = {
            "종가": round(last, 2),
            "1개월 등락": f"{(last / closes[-22] - 1) * 100:+.1f}%" if len(closes) >= 22 else None,
            "20일선 대비": f"{(last / ma20 - 1) * 100:+.1f}%",
            "52주 최고가 대비": f"{(last / max(closes) - 1) * 100:+.1f}%",
            "RSI(14)": round(r) if r is not None else None,
        }
    ctx["earnings"] = [
        f"{e[0]} EPS {_plain(e[1])}" + (f" (예상 {_plain(e[2])})" if e[2] is not None else "")
        for e in conn.execute(
            """SELECT COALESCE(to_char(reported_on, 'YYYY-MM-DD'), period), eps_actual, eps_estimate FROM stock_earnings
               WHERE ticker = %s AND eps_actual IS NOT NULL ORDER BY reported_on DESC NULLS LAST LIMIT 2""",
            (ticker,),
        ).fetchall()
    ]
    ctx["events"] = [
        f"{d} {t} {detail}".strip()
        for d, t, detail in conn.execute(
            """SELECT to_char(day, 'YYYY-MM-DD'), title, detail FROM calendar_events
               WHERE ticker = %s AND day BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 ORDER BY day LIMIT 3""",
            (ticker,),
        ).fetchall()
    ]
    # 미국 금리·지표는 국내 종목에도 영향을 주므로 미국 일정은 늘 넣고, 국내 일정은 국내 종목에만 넣습니다.
    ctx["macro"] = [
        f"{d} {t} {detail}".strip()
        for d, t, detail in conn.execute(
            """SELECT to_char(day, 'YYYY-MM-DD'), title, detail FROM calendar_events
               WHERE kind IN ('policy', 'economic') AND (market = 'US' OR market = %s)
                 AND day BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 ORDER BY day LIMIT 6""",
            (market,),
        ).fetchall()
    ]
    ctx["news"] = [
        f"{d} {t}" for d, t in conn.execute(
            """SELECT to_char(published_at, 'MM-DD'), COALESCE(title_ko, title) FROM stock_news
               WHERE ticker = %s AND published_at > now() - interval '7 days' ORDER BY published_at DESC LIMIT 6""",
            (ticker,),
        ).fetchall()
    ]
    return ctx


def notice_sent(conn: psycopg.Connection, key: str) -> bool:
    return conn.execute("SELECT 1 FROM notices_sent WHERE key = %s", (key,)).fetchone() is not None


def mark_notice(conn: psycopg.Connection, key: str) -> None:
    conn.execute("INSERT INTO notices_sent (key) VALUES (%s) ON CONFLICT DO NOTHING", (key,))
    conn.execute("DELETE FROM notices_sent WHERE sent_at < now() - interval '60 days'")


def events_on(conn: psycopg.Connection, day) -> list[tuple[str, str, str]]:
    """그날 일정 (kind, title, detail). 실적은 지금 들고 있거나 일지에 열려 있는 종목만 남아 있습니다."""
    return conn.execute(
        "SELECT kind, title, detail FROM calendar_events WHERE day = %s ORDER BY kind, title", (day,)
    ).fetchall()


# 원/달러 환율: 키움 잔고의 환율, 없으면(미국 주식이 없을 때 등) 한국은행 환율.
USD_KRW = """COALESCE(NULLIF((SELECT exch_rate FROM us_account_summary WHERE id = 1), 0),
     (SELECT value FROM macro_indicators WHERE code = 'usdkrw'), 0)"""

# 내 돈 전체(원): 국내·미국 주식 평가 + 예수금. 예수금은 /잔고와 같이 D+2 값(없으면 지금 값), 달러는 원화로 바꿉니다.
TOTAL_KRW = f"""SELECT COALESCE((SELECT total_eval FROM account_summary WHERE id = 1), 0)
     + COALESCE((SELECT total_eval FROM us_account_summary WHERE id = 1), 0) * {USD_KRW}
     + COALESCE((SELECT sum(COALESCE(d2_deposit, deposit)) FROM cash_balances WHERE currency = 'KRW'), 0)
     + COALESCE((SELECT sum(COALESCE(d2_deposit, deposit)) FROM cash_balances WHERE currency = 'USD'), 0) * {USD_KRW}"""


def earnings_eve(conn: psycopg.Connection, day) -> list[tuple[str, tuple]]:
    """그날 실적을 발표하는 보유 종목: (티커, (이름, 시장, 일정 설명, 평단 대비 %, 비중 %, 손절, 익절, 지난 서프라이즈 %))"""
    rows = conn.execute(
        f"""SELECT h.ticker, h.name, h.market, c.detail, h.pnl_pct,
                  h.eval_amount * CASE WHEN h.market = 'US' THEN {USD_KRW} ELSE 1 END,
                  (SELECT max(price) FROM alerts a WHERE a.ticker = h.ticker AND a.active AND a.kind = 'stop'),
                  (SELECT min(price) FROM alerts a WHERE a.ticker = h.ticker AND a.active AND a.kind = 'target'),
                  (SELECT (e.eps_actual - e.eps_estimate) / NULLIF(abs(e.eps_estimate), 0) * 100 FROM stock_earnings e
                    WHERE e.ticker = h.ticker AND e.eps_actual IS NOT NULL AND e.eps_estimate IS NOT NULL ORDER BY e.period DESC LIMIT 1)
           FROM calendar_events c JOIN holdings h ON h.ticker = c.ticker AND h.quantity > 0
           WHERE c.kind = 'earnings' AND c.day = %s ORDER BY h.name""",
        (day,),
    ).fetchall()
    total = conn.execute(TOTAL_KRW).fetchone()[0]
    out = []
    for ticker, name, market, detail, pnl, value, stop, target, surprise in rows:
        weight = float(value) / float(total) * 100 if total and value is not None else None
        out.append((ticker, (name, market, detail or "", float(pnl), weight,
                             float(stop) if stop else None, float(target) if target else None,
                             float(surprise) if surprise is not None else None)))
    return out


def record_assets(conn: psycopg.Connection, day) -> None:
    """오늘(한국 날짜) 내 돈 전체(원화 환산)를 적어 둡니다. 하루에 여러 번 불려도 마지막 값이 남아요."""
    total = conn.execute(TOTAL_KRW).fetchone()[0]
    if total and total > 0:
        conn.execute("INSERT INTO asset_history (day, total) VALUES (%s, %s) ON CONFLICT (day) DO UPDATE SET total = EXCLUDED.total",
                     (day, total))


def weekly_inputs(conn: psycopg.Connection, start, end):
    """주간 성적표에 쓸 값: (지금 전체, start 전날까지 마지막 전체, 보유 종목 주간 등락, 다음 주 일정)."""
    now = conn.execute("SELECT total FROM asset_history WHERE day <= %s ORDER BY day DESC LIMIT 1", (end,)).fetchone()
    before = conn.execute("SELECT total FROM asset_history WHERE day < %s ORDER BY day DESC LIMIT 1", (start,)).fetchone()
    moves = conn.execute(
        """SELECT h.name, (SELECT close FROM price_history p WHERE p.ticker = h.ticker AND p.day <= %s ORDER BY day DESC LIMIT 1),
                  (SELECT close FROM price_history p WHERE p.ticker = h.ticker AND p.day < %s ORDER BY day DESC LIMIT 1)
           FROM holdings h WHERE h.quantity > 0""",
        (end, start),
    ).fetchall()
    events = conn.execute(
        "SELECT day, kind, title FROM calendar_events WHERE day > %s AND day <= %s + 7 ORDER BY day, kind, title", (end, end)
    ).fetchall()
    return (float(now[0]) if now else None, float(before[0]) if before else None,
            [(n, (float(a) / float(b) - 1) * 100) for n, a, b in moves if a and b],
            [(d, k, t) for d, k, t in events])


def review_inputs(conn: psycopg.Connection):
    """사후강평 알림에 쓸 (키움 체결 전부, 지금 보유 수량, 강평을 쓴 권 키)."""
    from .books import Trade

    trades = [Trade(*r) for r in conn.execute(
        """SELECT market, ticker, COALESCE(NULLIF(name, ''), ticker), trade_date, fill_time, side, quantity, price, fee
           FROM trade_fills"""
    ).fetchall()]
    held = {(m, t): q for m, t, q in conn.execute("SELECT market, ticker, quantity FROM holdings").fetchall()}
    reviewed = {r[0] for r in conn.execute("SELECT book_key FROM book_reviews").fetchall()}
    return trades, held, reviewed


def briefing_holdings(conn: psycopg.Connection) -> list[tuple[str, str, float, float | None, float]]:
    """아침 브리핑용 보유 종목 (이름, 시장, 현재가, 전일 대비 %, 평단 대비 %). 국내 먼저, 시장 안에서는 평가금액이 큰 순서입니다."""
    rows = conn.execute(
        """SELECT h.name, h.market, h.cur_price, h.pnl_pct,
                  (SELECT array_agg(close ORDER BY day DESC) FROM
                     (SELECT day, close FROM price_history p WHERE p.ticker = h.ticker ORDER BY day DESC LIMIT 2) t)
           FROM holdings h WHERE h.quantity > 0 ORDER BY h.market, h.eval_amount DESC"""
    ).fetchall()
    out = []
    for name, market, price, pnl, closes in rows:
        change = None
        if closes and len(closes) == 2 and closes[1]:
            change = (float(closes[0]) / float(closes[1]) - 1) * 100
        out.append((name, market, float(price), change, float(pnl)))
    return out


# ---------------------------------------------------------------- 텔레그램 명령

def save_fills(conn: psycopg.Connection, fills) -> None:
    # kt00015(수수료 포함)가 정본입니다. 하루치 조회(kt00009) 값은 kt00015 값을 덮지 않습니다.
    for f in fills:
        conn.execute(
            """INSERT INTO trade_fills (fill_key, market, trade_date, ticker, name, side, quantity, price, fee, fill_time, fill_count, source)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (fill_key) DO UPDATE SET name = EXCLUDED.name, quantity = EXCLUDED.quantity, price = EXCLUDED.price,
                 fee = EXCLUDED.fee, fill_time = COALESCE(EXCLUDED.fill_time, trade_fills.fill_time),
                 fill_count = EXCLUDED.fill_count, source = EXCLUDED.source, fetched_at = now()
               WHERE trade_fills.source <> 'kt00015' OR EXCLUDED.source = 'kt00015'""",
            (f.key, f.market, f.day, f.ticker, f.name, f.side, f.quantity, f.price, f.fee, f.time, f.count, f.source),
        )


def us_tickers(conn: psycopg.Connection) -> list[str]:
    """체결을 종목별로 물어야 할 때 쓸 미국 종목: 보유, 매매일지, 관심종목, 이미 받은 체결"""
    rows = conn.execute(
        """SELECT ticker FROM holdings WHERE market = 'US'
           UNION SELECT ticker FROM positions WHERE market = 'US'
           UNION SELECT ticker FROM watchlist WHERE market = 'US'
           UNION SELECT ticker FROM trade_fills WHERE market = 'US'
           ORDER BY 1""",
    ).fetchall()
    return [r[0] for r in rows]


def get_setting(conn: psycopg.Connection, key: str):
    row = conn.execute("SELECT value FROM app_settings WHERE key = %s", (key,)).fetchone()
    return row[0] if row else None


def set_setting(conn: psycopg.Connection, key: str, value) -> None:
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (key, Jsonb(value)),
    )


def command_accounts(conn: psycopg.Connection) -> tuple[list[tuple], float]:
    """(시장, 평가, 손익, 손익률, 예수금) 목록과 원/달러 환율"""
    cash = {m: float(d2 if d2 is not None else dep) for m, dep, d2 in conn.execute("SELECT market, deposit, d2_deposit FROM cash_balances")}
    out = []
    for market, table in (("KR", "account_summary"), ("US", "us_account_summary")):
        row = conn.execute(f"SELECT total_eval, total_pnl, total_pnl_pct FROM {table} WHERE id = 1").fetchone()
        if row:
            out.append((market, float(row[0]), float(row[1]), float(row[2]), cash.get(market)))
        elif market in cash:
            # 주식은 없어도 예수금만 있는 계좌도 총자산에 넣습니다.
            out.append((market, 0.0, 0.0, 0.0, cash[market]))
    rate = conn.execute(f"SELECT {USD_KRW}").fetchone()
    return out, float(rate[0]) if rate else 0.0


def command_holdings(conn: psycopg.Connection) -> list[tuple]:
    return [(n, m, float(p), float(r)) for n, m, p, r in conn.execute(
        "SELECT name, market, cur_price, pnl_pct FROM holdings WHERE quantity > 0 ORDER BY market, eval_amount DESC")]


def command_alerts(conn: psycopg.Connection) -> list[tuple]:
    rows = conn.execute(
        """SELECT a.name, COALESCE(h.market, w.market, 'KR'), a.kind, a.direction, a.price, COALESCE(h.cur_price, q.price)
           FROM alerts a
           LEFT JOIN holdings h ON h.ticker = a.ticker
           LEFT JOIN watchlist w ON w.ticker = a.ticker
           LEFT JOIN watch_quotes q ON q.ticker = a.ticker
           WHERE a.active ORDER BY a.name, a.price"""
    ).fetchall()
    return [(n, m, k, d, float(p), float(c) if c is not None else None) for n, m, k, d, p, c in rows]


def command_calendar(conn: psycopg.Connection, today) -> list[tuple]:
    return conn.execute(
        "SELECT day, title FROM calendar_events WHERE day >= %s AND day < %s + 7 ORDER BY day, kind DESC, title",
        (today, today),
    ).fetchall()


def command_watch(conn: psycopg.Connection) -> list[tuple]:
    rows = conn.execute(
        """SELECT w.name, w.market, COALESCE(h.cur_price, q.price), q.change_pct,
             (SELECT a.price FROM alerts a WHERE a.ticker = w.ticker AND a.kind = 'custom' AND a.active
              ORDER BY abs(a.price - COALESCE(h.cur_price, q.price, a.price)) LIMIT 1)
           FROM watchlist w
           LEFT JOIN holdings h ON h.ticker = w.ticker AND h.quantity > 0
           LEFT JOIN watch_quotes q ON q.ticker = w.ticker
           ORDER BY w.created_at"""
    ).fetchall()
    f = lambda v: float(v) if v is not None else None
    return [(n, m, f(c), f(ch), f(t)) for n, m, c, ch, t in rows]
