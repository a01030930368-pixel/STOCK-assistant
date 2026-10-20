"""장중에 키움 잔고를 동기화하고 손절·익절 알림을 텔레그램으로 보냅니다."""
import logging
import time
from datetime import datetime, timedelta, timezone

import psycopg

import httpx

from . import alerts, config, db, levels, logsafe, macro, telegram
from .kiwoom import KiwoomClient
from .research_job import ResearchJob
from .screener_job import ScreenerJob
from .intraday_job import IntradayJob
from .ai_job import AiJob
from .briefing_job import BriefingJob
from .watch_job import WatchJob
from .bot import Bot
from .fills_job import FillsJob
from .market import kr_market_open, us_market_open

log = logging.getLogger("worker")


def tick(cfg: config.Config, conn: psycopg.Connection, kiwoom: KiwoomClient | None, kr: bool, us: bool) -> None:
    # 한쪽 시장 조회가 실패해도 다른 시장과 알림은 계속 돌도록 따로 처리합니다.
    if kiwoom and kr:
        try:
            db.save_balance(conn, kiwoom.domestic_balance())
        except Exception:
            log.exception("국내 잔고 동기화 실패")
        try:
            db.save_cash(conn, "KR", kiwoom.kr_cash())
        except Exception:
            log.exception("국내 예수금 동기화 실패")
    if kiwoom and us:
        try:
            db.save_us_balance(conn, kiwoom.us_balance())
        except Exception:
            log.exception("미국 잔고 동기화 실패")
        try:
            db.save_cash(conn, "US", kiwoom.us_cash())
        except Exception:
            log.exception("미국 예수금 동기화 실패")
    if kiwoom and (kr or us):
        try:
            db.snapshot_prices(conn)
        except Exception:
            log.exception("차트용 종가 저장 실패")
    prices = db.current_prices(conn)
    for alert, price in alerts.due(db.active_alerts(conn), prices):
        text = alerts.message(alert, price)
        if cfg.telegram_bot_token and cfg.telegram_chat_id:
            telegram.send(cfg.telegram_bot_token, cfg.telegram_chat_id, text)
        log.info("알림 발송: %s", text)
        db.mark_triggered(conn, alert.id)
    for level, price, send in levels.due(db.chart_levels(conn), prices, datetime.now(timezone.utc)):
        if send:
            text = levels.message(level, price)
            if cfg.telegram_bot_token and cfg.telegram_chat_id:
                telegram.send(cfg.telegram_bot_token, cfg.telegram_chat_id, text)
            log.info("지지·저항 알림 발송: %s", text)
        db.save_level_seen(conn, level.id, price, send)


MACRO_EVERY = timedelta(hours=6)


def refresh_macro(cfg: config.Config, conn: psycopg.Connection, http: httpx.Client) -> None:
    today = datetime.now(timezone.utc).date()
    sources = []
    if cfg.ecos_api_key:
        sources.append(("ECOS", lambda: macro.fetch_ecos(cfg.ecos_api_key, today, http)))
    if cfg.fred_api_key:
        sources.append(("FRED", lambda: macro.fetch_fred(cfg.fred_api_key, http)))
    for name, fetch in sources:
        try:
            db.save_indicators(conn, fetch())
        except Exception:
            log.exception("%s 매크로 지표 가져오기 실패", name)


def main() -> None:
    cfg = config.load()
    logsafe.setup([
        cfg.kiwoom_appkey, cfg.kiwoom_secretkey, cfg.telegram_bot_token,
        cfg.ecos_api_key, cfg.fred_api_key, cfg.dart_api_key,
        cfg.naver_client_id, cfg.naver_client_secret, cfg.finnhub_api_key, cfg.anthropic_api_key, cfg.gemini_api_key,
    ])
    kiwoom = None
    if cfg.kiwoom_appkey and cfg.kiwoom_secretkey:
        kiwoom = KiwoomClient(cfg.kiwoom_base_url, cfg.kiwoom_appkey, cfg.kiwoom_secretkey)
    else:
        log.warning("키움 키가 없어 잔고 동기화를 건너뜁니다.")
    if not (cfg.ecos_api_key or cfg.fred_api_key):
        log.warning("ECOS·FRED 키가 없어 매크로 지표 자동 수집을 건너뜁니다.")
    http = httpx.Client(timeout=30)
    research = ResearchJob(cfg, http, kiwoom)
    screener = ScreenerJob(kiwoom)
    minutes = IntradayJob(http, kiwoom)
    comments = AiJob(cfg, http)
    notices = BriefingJob(cfg, http)
    watching = WatchJob(cfg, http, kiwoom)
    trades = FillsJob(kiwoom)
    first = True
    last_macro: datetime | None = None
    with psycopg.connect(cfg.database_url, autocommit=True) as conn:
        db.migrate(conn)
        Bot(cfg).start()
        while True:
            now = datetime.now(timezone.utc)
            if last_macro is None or now - last_macro >= MACRO_EVERY:
                refresh_macro(cfg, conn, http)
                last_macro = now
            kr, us = first or kr_market_open(now), first or us_market_open(now)
            if kr or us:
                try:
                    tick(cfg, conn, kiwoom, kr, us)
                except Exception:
                    log.exception("동기화 실패")
                first = False
            try:
                research.run(conn, now)
            except Exception:
                log.exception("종목 정보 수집 실패")
            try:
                watching.run(conn, now)
            except Exception:
                log.exception("관심종목 갱신 실패")
            try:
                trades.run(conn, now)
            except Exception:
                log.exception("체결 내역 갱신 실패")
            try:
                screener.run(conn, now)
            except Exception:
                log.exception("검색기 갱신 실패")
            try:
                minutes.run(conn, now)
            except Exception:
                log.exception("분봉 갱신 실패")
            try:
                comments.run(conn, now)
            except Exception:
                log.exception("AI 한마디 실패")
            try:
                notices.run(conn, now)
            except Exception:
                log.exception("일정 알림 실패")
            time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    main()
