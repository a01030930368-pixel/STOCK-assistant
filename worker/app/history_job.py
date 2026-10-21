"""두 종목 비교·매매 복기에 쓰는 일봉을 채워요.

- 비교 화면에서 고른 종목 중 일봉이 없는 것: 화면이 남긴 요청(history_request)을 보고 바로 받아요.
- 예전에 사고판 종목(지금은 안 보는 종목): 하루 한 번, 판 뒤 주가를 이어 그릴 수 있게 받아요.
- 비교 기준 지수(코스피, S&P 500은 SPY): 하루 한 번 sector_daily에 market 'IX'로 넣어요.
"""
import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import db, prices

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")
MAX_REQUEST = 8  # 한 번에 받는 요청 종목 수


def kospi_scale(closes: list) -> list:
    """업종일봉이 소수점 없이 100배로 오면 되돌려요. 코스피가 2만을 넘을 일은 없으니 그걸로 가려요."""
    if closes and closes[-1][1] > 20000:
        return [(d, c / 100) for d, c in closes]
    return closes


class HistoryJob:
    def __init__(self, http: httpx.Client, kiwoom=None):
        self.http = http
        self.kiwoom = kiwoom
        self.daily_on: str | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        self._requests(conn, now)
        kst = now.astimezone(KST)
        # 국내 장 마감 뒤(16시)와 처음 켰을 때 하루 한 번
        stamp = f"{kst.date()}:{kst.hour >= 16}"
        if self.daily_on != stamp:
            self.daily_on = stamp
            self._benchmarks(conn, kst)
            for ticker, market in db.traded_unwatched(conn):
                self._fetch(conn, ticker, market, kst)

    def _fetch(self, conn: psycopg.Connection, ticker: str, market: str, kst: datetime) -> str | None:
        try:
            if market == "KR":
                if not self.kiwoom:
                    return "키움 키가 없어요"
                db.save_prices(conn, ticker, self.kiwoom.kr_daily(ticker, kst.strftime("%Y%m%d")))
            else:
                db.save_prices(conn, ticker, prices.us_daily(ticker, self.http))
        except Exception as e:
            log.warning("%s 일봉 받기 실패: %s", ticker, e)
            return f"{ticker}: {str(e)[:120]}"
        return None

    def _requests(self, conn: psycopg.Connection, now: datetime) -> None:
        asked = db.get_setting(conn, "history_request")
        if not asked or not isinstance(asked, dict) or not asked.get("tickers"):
            return
        kst = now.astimezone(KST)
        errors = []
        for item in asked["tickers"][:MAX_REQUEST]:
            ticker, market = str(item[0]).upper(), "KR" if item[1] == "KR" else "US"
            if (err := self._fetch(conn, ticker, market, kst)):
                errors.append(err)
        db.clear_setting_if(conn, "history_request", asked)
        db.set_setting(conn, "history_status", {"at": now.isoformat(), "ok": not errors, **({"error": "; ".join(errors)[:300]} if errors else {})})

    def _benchmarks(self, conn: psycopg.Connection, kst: datetime) -> None:
        if self.kiwoom:
            try:
                db.save_sector_daily(conn, "IX", "KOSPI", kospi_scale(self.kiwoom.sector_daily("001", kst.strftime("%Y%m%d"))))
            except Exception as e:
                log.warning("코스피 일봉 받기 실패: %s", e)
        try:
            candles = prices.yahoo_daily("SPY", self.http, "2y")
            db.save_sector_daily(conn, "IX", "SPX", [(c.day, c.close) for c in candles])
        except Exception as e:
            log.warning("S&P 500(SPY) 일봉 받기 실패: %s", e)
