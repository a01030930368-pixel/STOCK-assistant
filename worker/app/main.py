"""장중에 키움 잔고를 동기화하고 손절·익절 알림을 텔레그램으로 보냅니다."""
import logging
import time
from datetime import datetime, timezone

import psycopg

from . import alerts, config, db, telegram
from .kiwoom import KiwoomClient
from .market import kr_market_open

log = logging.getLogger("worker")


def tick(cfg: config.Config, conn: psycopg.Connection, kiwoom: KiwoomClient | None) -> None:
    if kiwoom:
        db.save_balance(conn, kiwoom.domestic_balance())
    prices = db.current_prices(conn)
    for alert, price in alerts.due(db.active_alerts(conn), prices):
        text = alerts.message(alert, price)
        if cfg.telegram_bot_token and cfg.telegram_chat_id:
            telegram.send(cfg.telegram_bot_token, cfg.telegram_chat_id, text)
        log.info("알림 발송: %s", text)
        db.mark_triggered(conn, alert.id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = config.load()
    kiwoom = None
    if cfg.kiwoom_appkey and cfg.kiwoom_secretkey:
        kiwoom = KiwoomClient(cfg.kiwoom_base_url, cfg.kiwoom_appkey, cfg.kiwoom_secretkey)
    else:
        log.warning("키움 키가 없어 잔고 동기화를 건너뜁니다.")
    first = True
    with psycopg.connect(cfg.database_url, autocommit=True) as conn:
        while True:
            if first or kr_market_open(datetime.now(timezone.utc)):
                try:
                    tick(cfg, conn, kiwoom)
                except Exception:
                    log.exception("동기화 실패")
                first = False
            time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    main()
