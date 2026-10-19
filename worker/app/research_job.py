"""종목 정보 수집 일정. 뉴스는 1시간, 실적·재무는 12시간마다 모읍니다."""
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import db, research
from .config import Config

log = logging.getLogger("worker")

NEWS_EVERY = timedelta(hours=1)
FUNDAMENTALS_EVERY = timedelta(hours=12)
CODES_EVERY = timedelta(days=1)


class ResearchJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.cfg = cfg
        self.http = http
        self.last_news: datetime | None = None
        self.last_fundamentals: datetime | None = None
        self.dart_codes: dict[str, str] = {}
        self.sec_ciks: dict[str, int] = {}
        self.codes_at: datetime | None = None

    @property
    def user_agent(self) -> str:
        return f"STOCK-assistant {self.cfg.sec_contact_email}"

    def enabled(self) -> bool:
        c = self.cfg
        return bool(c.dart_api_key or (c.naver_client_id and c.naver_client_secret) or c.finnhub_api_key or c.sec_contact_email)

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if self.last_news is None or now - self.last_news >= NEWS_EVERY:
            self.last_news = now
            self._news(conn, now)
        if self.last_fundamentals is None or now - self.last_fundamentals >= FUNDAMENTALS_EVERY:
            self.last_fundamentals = now
            self._refresh_codes(now)
            self._fundamentals(conn, now)

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
            elif market == "US" and c.finnhub_api_key:
                self._try(f"{ticker} 뉴스", lambda: db.save_news(
                    conn, research.finnhub_news(ticker, c.finnhub_api_key, now.date(), self.http)))

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
