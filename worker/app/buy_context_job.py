"""매수·매도 일지에 '그날의 기록'을 남깁니다: 거래일 기준 매크로 값(기준금리·환율·물가)과, 그날까지의 일봉.

일봉은 화면이 일지를 처음 열 때 차트 그림으로 한 번 저장합니다. 옛날에 쓴 일지도 거래일 기준으로 채워요.
"""
import logging
from datetime import date, datetime, timedelta, timezone

import httpx
import psycopg

from . import db, macro, prices

log = logging.getLogger("worker")

EVERY = timedelta(minutes=10)
MIN_BARS = 20


class BuyContextJob:
    def __init__(self, cfg, http: httpx.Client, kiwoom=None):
        self.cfg = cfg
        self.http = http
        self.kiwoom = kiwoom
        self.last: datetime | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if self.last and now - self.last < EVERY:
            return
        self.last = now
        for side, entry_id, day, ticker, market in db.entries_without_context(conn):
            self._prices(conn, ticker, market, day)
            values, failed = self._macro(day)
            if failed and not values:
                continue  # 매크로 서버가 다 막혔으면 다음에 다시 해요
            db.save_entry_context(conn, side, entry_id, {"macro": values, "day": day.isoformat(), "at": now.isoformat()})
            log.info("%s 일지 %s(%s %s)에 그날 매크로 %d개를 남겼습니다", "매도" if side == "sell" else "매수", entry_id, ticker, day, len(values))

    def _macro(self, day: date) -> tuple[dict, bool]:
        sources = []
        if self.cfg.ecos_api_key:
            sources.append(("ECOS", lambda: macro.fetch_ecos(self.cfg.ecos_api_key, day, self.http)))
        if self.cfg.fred_api_key:
            sources.append(("FRED", lambda: macro.fetch_fred(self.cfg.fred_api_key, self.http, day)))
        values, failed = {}, False
        for name, fetch in sources:
            try:
                for i in fetch():
                    values[i.code] = {"value": str(i.value), "as_of": i.as_of}
            except Exception as e:
                log.warning("%s 거래일 매크로 가져오기 실패: %s", name, e)
                failed = True
        return values, failed

    def _prices(self, conn: psycopg.Connection, ticker: str, market: str, day: date) -> None:
        # 그날까지 일봉이 모자라면(오래전 거래, 지금은 안 보는 종목) 한 번 받아 둡니다.
        if db.price_rows_before(conn, ticker, day) >= MIN_BARS:
            return
        try:
            if market == "KR" and self.kiwoom:
                db.save_prices(conn, ticker, self.kiwoom.kr_daily(ticker, day.strftime("%Y%m%d")))
            elif market == "US":
                db.save_prices(conn, ticker, prices.us_daily(ticker, self.http))
        except Exception as e:
            log.warning("%s 거래일 일봉 가져오기 실패: %s", ticker, e)
