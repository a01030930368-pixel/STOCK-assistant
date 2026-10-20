"""장중에 키움 잔고를 동기화하고 손절·익절 알림을 텔레그램으로 보냅니다."""
import logging
import threading
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
from .isa_job import IsaJob
from .buy_context_job import BuyContextJob
from .market import kr_market_open, kr_trading_now, us_market_open, us_trading_now

log = logging.getLogger("worker")


def settle(conn: psycopg.Connection, market: str) -> None:
    for pid in db.close_sold_positions(conn, market):
        log.info("다 판 종목의 매매일지(%s)를 끝난 것으로 바꾸고 손절·익절 알림을 껐습니다", pid)


def tick(cfg: config.Config, conn: psycopg.Connection, kiwoom: KiwoomClient | None, kr: bool, us: bool,
         now: datetime | None = None, isa: KiwoomClient | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    # 한쪽 시장 조회가 실패해도 다른 시장과 알림은 계속 돌도록 따로 처리합니다.
    if kiwoom and kr:
        try:
            db.save_balance(conn, kiwoom.domestic_balance())
            settle(conn, "KR")
        except Exception:
            log.exception("국내 잔고 동기화 실패")
        try:
            db.save_cash(conn, "KR", kiwoom.kr_cash())
        except Exception:
            log.exception("국내 예수금 동기화 실패")
    if isa and kr:
        try:
            db.save_isa_balance(conn, isa.domestic_balance())
            db.set_setting(conn, "isa_balance_status", {"at": now.isoformat(), "ok": True})
        except Exception as e:
            log.exception("ISA 잔고 동기화 실패")
            # 화면 ISA 카드에 이유를 보여 줍니다(예: 이 계좌는 REST API를 못 쓰는 경우).
            db.set_setting(conn, "isa_balance_status", {"at": now.isoformat(), "ok": False, "error": str(e)[:200]})
        try:
            db.save_isa_cash(conn, isa.kr_cash())
        except Exception:
            log.exception("ISA 예수금 동기화 실패")
    if kiwoom and us:
        try:
            db.save_us_balance(conn, kiwoom.us_balance())
            settle(conn, "US")
        except Exception:
            log.exception("미국 잔고 동기화 실패")
        try:
            db.save_cash(conn, "US", kiwoom.us_cash())
        except Exception:
            log.exception("미국 예수금 동기화 실패")
    # 오늘 일봉은 정규장이 실제로 열린 시장만 적습니다. 주말·장 전에 켜도 가짜 봉이 생기지 않아요.
    trading = [m for m, on in (("KR", kr_trading_now(now)), ("US", us_trading_now(now))) if on]
    if kiwoom and trading:
        try:
            db.snapshot_prices(conn, trading)
        except Exception:
            log.exception("차트용 종가 저장 실패")
    prices = db.current_prices(conn)
    for alert, price in alerts.due(db.active_alerts(conn), prices):
        text = alerts.message(alert, price)
        if cfg.telegram_bot_token and cfg.telegram_chat_id:
            if not telegram.deliver(cfg.telegram_bot_token, cfg.telegram_chat_id, text):
                continue
        log.info("알림 발송: %s", text)
        db.mark_triggered(conn, alert.id)
    for level, price, send in levels.due(db.chart_levels(conn), prices, now):
        if send:
            text = levels.message(level, price)
            if cfg.telegram_bot_token and cfg.telegram_chat_id:
                if not telegram.deliver(cfg.telegram_bot_token, cfg.telegram_chat_id, text):
                    continue
            log.info("지지·저항 알림 발송: %s", text)
        db.save_level_seen(conn, level.id, price, send)


def connect(url: str) -> psycopg.Connection:
    # 날짜 계산(CURRENT_DATE 등)이 한국 날짜로 되도록 접속마다 시간대를 정합니다.
    return psycopg.connect(url, autocommit=True, options="-c timezone=Asia/Seoul")


class Connection:
    """끊기면 다시 붙는 DB 연결. Docker나 DB가 잠깐 멈췄다 돌아와도 워커가 계속 일합니다."""

    def __init__(self, url: str):
        self.url = url
        self.conn: psycopg.Connection | None = None

    def get(self) -> psycopg.Connection:
        if self.conn is None or self.conn.closed or self.conn.broken:
            if self.conn is not None:
                log.warning("DB 연결이 끊겨 다시 연결합니다")
                try:
                    self.conn.close()
                except Exception:
                    pass
            self.conn = connect(self.url)
        return self.conn

    def check(self) -> None:
        # 작업이 실패한 뒤 연결이 살아 있는지 확인합니다. 죽었으면 다음 get()에서 새로 붙습니다.
        if self.conn is None:
            return
        try:
            self.conn.execute("SELECT 1")
        except Exception:
            log.warning("DB 연결이 끊겨 다음 차례에 다시 연결합니다")
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None


def alert_loop(cfg: config.Config, kiwoom: KiwoomClient | None, isa: KiwoomClient | None = None) -> None:
    """잔고와 손절·익절·지지저항 알림만 따로 도는 줄. 무거운 수집 작업이 길어져도 알림은 밀리지 않아요."""
    db_conn = Connection(cfg.database_url)
    first = True
    while True:
        try:
            now = datetime.now(timezone.utc)
            kr, us = kr_market_open(now), us_market_open(now)
            # 처음 켤 때는 장이 닫혀 있어도 잔고를 한 번 받아 화면을 채웁니다.
            if first or kr or us:
                tick(cfg, db_conn.get(), kiwoom, first or kr, first or us, now, isa)
                first = False
        except Exception:
            log.exception("동기화 실패")
            db_conn.check()
        time.sleep(cfg.poll_seconds)


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
        cfg.kiwoom_isa_appkey, cfg.kiwoom_isa_secretkey,
    ])
    kiwoom = None
    if cfg.kiwoom_appkey and cfg.kiwoom_secretkey:
        kiwoom = KiwoomClient(cfg.kiwoom_base_url, cfg.kiwoom_appkey, cfg.kiwoom_secretkey)
    else:
        log.warning("키움 키가 없어 잔고 동기화를 건너뜁니다.")
    # ISA 계좌는 키를 따로 받습니다. 국내 주식만 되는 계좌라 국내 조회만 씁니다.
    isa = None
    if cfg.kiwoom_isa_appkey and cfg.kiwoom_isa_secretkey:
        isa = KiwoomClient(cfg.kiwoom_base_url, cfg.kiwoom_isa_appkey, cfg.kiwoom_isa_secretkey)
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
    isa_trades = IsaJob(isa)
    buy_context = BuyContextJob(cfg, http, kiwoom)
    last_macro: datetime | None = None
    db_conn = Connection(cfg.database_url)
    while True:
        try:
            db.migrate(db_conn.get())
            break
        except Exception:
            log.exception("DB 준비 실패, 잠시 뒤 다시 시도합니다")
            db_conn.check()
            time.sleep(10)
    Bot(cfg).start()
    threading.Thread(target=alert_loop, args=(cfg, kiwoom, isa), name="alerts", daemon=True).start()
    jobs = [
        ("종목 정보 수집", research.run), ("관심종목 갱신", watching.run), ("체결 내역 갱신", trades.run),
        ("ISA 체결 갱신", isa_trades.run), ("매수 당시 기록", buy_context.run),
        ("검색기 갱신", screener.run), ("분봉 갱신", minutes.run), ("AI 한마디", comments.run), ("일정 알림", notices.run),
    ]
    while True:
        now = datetime.now(timezone.utc)
        try:
            conn = db_conn.get()
        except Exception:
            log.exception("DB 연결 실패, 잠시 뒤 다시 시도합니다")
            time.sleep(cfg.poll_seconds)
            continue
        if last_macro is None or now - last_macro >= MACRO_EVERY:
            refresh_macro(cfg, conn, http)
            last_macro = now
        failed = False
        for name, run in jobs:
            try:
                run(conn, now)
            except Exception:
                log.exception("%s 실패", name)
                failed = True
        if failed:
            db_conn.check()
        time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    main()
