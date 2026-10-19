"""장중에 키움 잔고를 동기화하고 손절·익절 알림을 텔레그램으로 보냅니다."""
import logging
import time
from datetime import datetime, timezone

import psycopg

from . import alerts, config, db, telegram
from .kiwoom import KiwoomClient
from .market import kr_market_open, us_market_open

log = logging.getLogger("worker")


def tick(cfg: config.Config, conn: psycopg.Connection, kiwoom: KiwoomClient | None, kr: bool, us: bool) -> None:
    # 한쪽 시장 조회가 실패해도 다른 시장과 알림은 계속 돌도록 따로 처리합니다.
    if kiwoom and kr:
        try:
            db.save_balance(conn, kiwoom.domestic_balance())
        except Exception:
            log.exception("국내 잔고 동기화 실패")
    if kiwoom and us:
        try:
            db.save_us_balance(conn, kiwoom.us_balance())
        except Exception:
            log.exception("미국 잔고 동기화 실패")
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
        db.migrate(conn)
        while True:
            now = datetime.now(timezone.utc)
            kr, us = first or kr_market_open(now), first or us_market_open(now)
            if kr or us:
                try:
                    tick(cfg, conn, kiwoom, kr, us)
                except Exception:
                    log.exception("동기화 실패")
                first = False
            time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    main()
