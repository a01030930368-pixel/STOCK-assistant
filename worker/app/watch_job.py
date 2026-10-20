"""관심종목 현재가는 장중 2분마다, 업종 이름은 하루에 한 번 확인해 일주일마다 새로 받습니다."""
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import db, watch
from .config import Config
from .market import kr_market_open, us_market_open

log = logging.getLogger("worker")

QUOTE_EVERY = timedelta(minutes=2)
SECTOR_EVERY = timedelta(days=1)
OPEN = {"KR": kr_market_open, "US": us_market_open}


class WatchJob:
    def __init__(self, cfg: Config, http: httpx.Client, kiwoom=None):
        self.cfg = cfg
        self.http = http
        self.kiwoom = kiwoom
        self.last: dict[str, datetime] = {}
        self.was_open: dict[str, bool] = {}
        self.last_sector: datetime | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        self._quotes(conn, now)
        if self.last_sector is None or now - self.last_sector >= SECTOR_EVERY:
            self.last_sector = now
            self._sectors(conn)

    def _quote(self, ticker: str, market: str):
        if market == "KR":
            return self.kiwoom.kr_quote(ticker) if self.kiwoom else None
        return watch.yahoo_quote(ticker, self.http)

    def _quotes(self, conn: psycopg.Connection, now: datetime) -> None:
        # 분봉과 같은 방식: 처음 한 번, 장중 2분마다, 마감 직후 한 번
        for market, is_open in OPEN.items():
            open_now = is_open(now)
            first = market not in self.last
            just_closed = self.was_open.get(market) and not open_now
            self.was_open[market] = open_now
            if not (first or just_closed or (open_now and now - self.last[market] >= QUOTE_EVERY)):
                continue
            self.last[market] = now
            for ticker, name, m in db.watch_targets(conn):
                if m != market:
                    continue
                try:
                    quote = self._quote(ticker, market)
                    if quote:
                        db.save_quote(conn, quote)
                except Exception as e:
                    log.warning("관심종목 %s 현재가 실패: %s", name, e)

    def _sectors(self, conn: psycopg.Connection) -> None:
        for ticker, name, market in db.sector_due(conn):
            try:
                if market == "KR":
                    if not self.kiwoom:
                        continue
                    sector = self.kiwoom.kr_sector(ticker)
                else:
                    if not self.cfg.finnhub_api_key:
                        continue
                    sector = watch.finnhub_sector(ticker, self.cfg.finnhub_api_key, self.http)
                db.save_sector(conn, ticker, market, sector)
            except Exception as e:
                log.warning("%s 업종 가져오기 실패: %s", name, e)
