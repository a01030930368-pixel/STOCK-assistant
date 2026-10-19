"""분봉 갱신. 각 시장이 열려 있는 동안 2분마다, 마감 직후 한 번 더 보유·관심 종목의 1분봉을 받습니다."""
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import db, intraday
from .market import kr_market_open, us_market_open

log = logging.getLogger("worker")

EVERY = timedelta(minutes=2)
OPEN = {"KR": kr_market_open, "US": us_market_open}


class IntradayJob:
    def __init__(self, http: httpx.Client, kiwoom=None):
        self.http = http
        self.kiwoom = kiwoom
        self.last: dict[str, datetime] = {}
        self.was_open: dict[str, bool] = {}

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        for market, is_open in OPEN.items():
            open_now = is_open(now)
            first = market not in self.last
            just_closed = self.was_open.get(market) and not open_now
            self.was_open[market] = open_now
            if not (first or just_closed or (open_now and now - self.last[market] >= EVERY)):
                continue
            self.last[market] = now
            for ticker, name, m in db.watched_stocks(conn):
                if m != market:
                    continue
                try:
                    if market == "KR":
                        if not self.kiwoom:
                            continue
                        bars = self.kiwoom.kr_minutes(ticker)
                    else:
                        bars = intraday.yahoo_minutes(ticker, self.http)
                    db.save_minutes(conn, ticker, bars)
                except Exception as e:
                    log.warning("%s 분봉 실패: %s", name, e)
