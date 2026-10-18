from decimal import Decimal

import psycopg

from .alerts import Alert
from .kiwoom import Balance


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


def current_prices(conn: psycopg.Connection) -> dict[str, Decimal]:
    return {row[0]: row[1] for row in conn.execute("SELECT ticker, cur_price FROM holdings")}


def active_alerts(conn: psycopg.Connection) -> list[Alert]:
    rows = conn.execute("SELECT id, ticker, name, kind, direction, price FROM alerts WHERE active").fetchall()
    return [Alert(*row) for row in rows]


def mark_triggered(conn: psycopg.Connection, alert_id: int) -> None:
    conn.execute("UPDATE alerts SET active = false, triggered_at = now() WHERE id = %s", (alert_id,))
