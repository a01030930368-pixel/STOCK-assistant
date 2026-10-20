"""종목 정보 수집 일정. 뉴스는 1시간, 실적·재무는 12시간마다 모읍니다."""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import calendar, db, dividends, prices, research, translate
from .config import Config

log = logging.getLogger("worker")

KST = ZoneInfo("Asia/Seoul")
NEWS_EVERY = timedelta(hours=1)
FUNDAMENTALS_EVERY = timedelta(hours=12)
CODES_EVERY = timedelta(days=1)


class ResearchJob:
    def __init__(self, cfg: Config, http: httpx.Client, kiwoom=None):
        self.cfg = cfg
        self.http = http
        self.kiwoom = kiwoom
        self.last_news: datetime | None = None
        self.last_fundamentals: datetime | None = None
        self.dart_codes: dict[str, str] = {}
        self.sec_ciks: dict[str, int] = {}
        self.codes_at: datetime | None = None
        self.tried_prices: set[str] = set()

    @property
    def user_agent(self) -> str:
        return f"STOCK-assistant {self.cfg.sec_contact_email}"

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if self.last_news is None or now - self.last_news >= NEWS_EVERY:
            self.last_news = now
            self._news(conn, now)
        if self.last_fundamentals is None or now - self.last_fundamentals >= FUNDAMENTALS_EVERY:
            self.last_fundamentals = now
            self._refresh_codes(now)
            self._fundamentals(conn, now)
            self._calendar(conn, now)
            self._dividends(conn, now)
            self._prices(conn, now)
        self._new_prices(conn, now)

    def _try(self, what: str, fn) -> None:
        # 한 종목·한 출처가 실패해도 나머지는 계속 모읍니다.
        try:
            fn()
        except Exception as e:
            log.warning("%s 실패: %s", what, e)

    def _news(self, conn: psycopg.Connection, now: datetime) -> None:
        c = self.cfg
        for ticker, name, market in db.watched_stocks(conn):
            if market == "KR" and c.naver_client_id and c.naver_client_secret:
                self._try(f"{name} 뉴스", lambda: db.save_news(
                    conn, research.naver_news(ticker, name, c.naver_client_id, c.naver_client_secret, self.http)))
            elif market == "KR":
                # 네이버 키가 없으면 키 없이 쓰는 구글 뉴스로 가져옵니다.
                self._try(f"{name} 뉴스", lambda: db.save_news(conn, research.google_news(ticker, name, self.http)))
            elif market == "US" and c.finnhub_api_key:
                self._try(f"{ticker} 뉴스", lambda: db.save_news(
                    conn, research.finnhub_news(ticker, c.finnhub_api_key, now.date(), self.http)))
        self._translate(conn)

    def _translate(self, conn: psycopg.Connection) -> None:
        # 한글이 든 제목(국내 뉴스)은 원문을 그대로 한국어 제목으로 둡니다.
        for ticker, url, title in db.untranslated_news(conn):
            if not translate.needs_translation(title):
                db.save_title_ko(conn, ticker, url, title)
                continue
            try:
                db.save_title_ko(conn, ticker, url, translate.to_korean(title, self.http))
            except Exception as e:
                log.warning("뉴스 제목 번역 실패, 다음 시간에 다시 합니다: %s", e)
                return

    def _prices(self, conn: psycopg.Connection, now: datetime) -> None:
        # 차트용 1년치 일봉 종가를 12시간마다 다시 받아 빈 날을 채웁니다.
        base = now.astimezone(KST).strftime("%Y%m%d")
        for ticker, name, market in db.watched_stocks(conn):
            if market == "KR" and self.kiwoom:
                self._try(f"{name} 일봉", lambda: db.save_prices(conn, ticker, self.kiwoom.kr_daily(ticker, base)))
            elif market == "US":
                self._try(f"{ticker} 일봉", lambda: db.save_prices(conn, ticker, prices.us_daily(ticker, self.http)))

    def _new_prices(self, conn: psycopg.Connection, now: datetime) -> None:
        # 새로 넣은 관심종목은 12시간을 기다리지 않고 바로 일봉을 받아 차트가 보이게 합니다.
        base = now.astimezone(KST).strftime("%Y%m%d")
        for ticker, name, market in db.unpriced_stocks(conn):
            if ticker in self.tried_prices:
                continue
            self.tried_prices.add(ticker)
            if market == "KR" and self.kiwoom:
                self._try(f"{name} 일봉", lambda: db.save_prices(conn, ticker, self.kiwoom.kr_daily(ticker, base)))
            elif market == "US":
                self._try(f"{ticker} 일봉", lambda: db.save_prices(conn, ticker, prices.us_daily(ticker, self.http)))

    def _calendar(self, conn: psycopg.Connection, now: datetime) -> None:
        today = now.date()
        self._try("휴장일", lambda: db.save_calendar(conn, "holiday", calendar.holiday_events(today)))
        self._try("금리 결정·만기일", lambda: db.save_calendar(conn, "policy", calendar.policy_events(today)))
        if self.cfg.fred_api_key:
            self._try("미국 경제지표 일정", lambda: db.save_calendar(
                conn, "economic", calendar.fred_release_events(self.cfg.fred_api_key, today, self.http)))
        if not self.cfg.finnhub_api_key:
            return
        for ticker, name, market in db.watched_stocks(conn):
            if market == "US":
                self._try(f"{ticker} 실적 일정", lambda: db.save_calendar(
                    conn, "earnings", calendar.finnhub_earnings_calendar(ticker, name, self.cfg.finnhub_api_key, today, self.http), ticker))

    def _dividends(self, conn: psycopg.Connection, now: datetime) -> None:
        # 보유 종목마다 배당 기록을 받고, 다음 배당락(발표됐거나 예상)을 일정에 넣습니다.
        today = now.astimezone(KST).date()
        for ticker, name, market, qty in db.held_quantities(conn):
            def one():
                history = dividends.yahoo_dividends(ticker, market, self.http)
                db.save_dividends(conn, ticker, history)
                event = dividends.dividend_event(ticker, name, market, qty, history, today)
                db.save_calendar(conn, "dividend", [event] if event else [], ticker)
            self._try(f"{name} 배당", one)

    def _refresh_codes(self, now: datetime) -> None:
        if self.codes_at and now - self.codes_at < CODES_EVERY:
            return
        if self.cfg.dart_api_key:
            self._try("DART 고유번호", lambda: setattr(self, "dart_codes", research.dart_corp_codes(self.cfg.dart_api_key, self.http)))
        if self.cfg.sec_contact_email:
            self._try("SEC 티커 목록", lambda: setattr(self, "sec_ciks", research.sec_ciks(self.user_agent, self.http)))
        self.codes_at = now

    def _fundamentals(self, conn: psycopg.Connection, now: datetime) -> None:
        c = self.cfg
        today = now.date()
        watched = db.watched_stocks(conn)
        for ticker, name, market in watched:
            if market == "KR" and (corp := self.dart_codes.get(ticker)):
                self._try(f"{name} 실적 공시", lambda: db.save_earnings(
                    conn, ticker, research.dart_earnings(ticker, corp, c.dart_api_key, today, self.http)))
            elif market == "US" and c.finnhub_api_key:
                self._try(f"{ticker} 실적", lambda: db.save_earnings(
                    conn, ticker, research.finnhub_earnings(ticker, c.finnhub_api_key, self.http)))
        seen = set()
        for ticker, name, market in watched + db.peer_stocks(conn):
            if ticker in seen:
                continue
            seen.add(ticker)
            if market == "KR" and (corp := self.dart_codes.get(ticker)):
                self._try(f"{name} 재무", lambda: db.save_financials(
                    conn, research.dart_financials(ticker, corp, c.dart_api_key, today, self.http)))
            elif market == "US" and (cik := self.sec_ciks.get(ticker.upper())):
                self._try(f"{ticker} 재무", lambda: db.save_financials(
                    conn, research.sec_financials(ticker, cik, self.user_agent, self.http)))
