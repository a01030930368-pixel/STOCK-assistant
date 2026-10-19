from decimal import Decimal

import psycopg

from .alerts import Alert
from .kiwoom import Balance, UsBalance
from .macro import Indicator


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


def save_indicators(conn: psycopg.Connection, indicators: list[Indicator]) -> None:
    for i in indicators:
        conn.execute(
            """INSERT INTO macro_indicators (code, value, as_of, fetched_at) VALUES (%s, %s, %s, now())
               ON CONFLICT (code) DO UPDATE SET value = EXCLUDED.value, as_of = EXCLUDED.as_of, fetched_at = now()""",
            (i.code, i.value, i.as_of),
        )


def current_prices(conn: psycopg.Connection) -> dict[str, Decimal]:
    return {row[0]: row[1] for row in conn.execute("SELECT ticker, cur_price FROM holdings")}


def active_alerts(conn: psycopg.Connection) -> list[Alert]:
    rows = conn.execute("SELECT id, ticker, name, kind, direction, price FROM alerts WHERE active").fetchall()
    return [Alert(*row) for row in rows]


def mark_triggered(conn: psycopg.Connection, alert_id: int) -> None:
    conn.execute("UPDATE alerts SET active = false, triggered_at = now() WHERE id = %s", (alert_id,))
