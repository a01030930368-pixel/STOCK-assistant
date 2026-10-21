"""섹터 동향을 모아요. 장중에는 국내 10분·미국 15분마다, 장이 닫혀 있으면 3시간마다 새로 받아요.

국내 지난 종가(ka20006)는 하루 한 번과 장 마감 직후에, 오늘 많이 움직인 종목은 장중 30분마다 받아요.
"""
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import db, prices, sectors
from .market import kr_market_open, us_market_open

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")

OPEN_EVERY = {"KR": timedelta(minutes=10), "US": timedelta(minutes=15)}
CLOSED_EVERY = timedelta(hours=3)
LEADERS_EVERY = timedelta(minutes=30)
OPEN = {"KR": kr_market_open, "US": us_market_open}


class SectorJob:
    def __init__(self, http: httpx.Client, kiwoom=None):
        self.http = http
        self.kiwoom = kiwoom
        self.last: dict[str, datetime] = {}
        self.was_open: dict[str, bool] = {}
        self.leaders_at: dict[str, datetime] = {}
        self.history_on: str | None = None  # 국내 지난 종가를 받은 날(KST)과 마감 뒤인지

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        for market in ("KR", "US"):
            if market == "KR" and not self.kiwoom:
                continue
            open_now = OPEN[market](now)
            just_closed = self.was_open.get(market) and not open_now
            self.was_open[market] = open_now
            last = self.last.get(market)
            every = OPEN_EVERY[market] if open_now else CLOSED_EVERY
            if last and not just_closed and now - last < every:
                continue
            self.last[market] = now
            leaders = market not in self.leaders_at or (open_now and now - self.leaders_at[market] >= LEADERS_EVERY) or just_closed
            if leaders:
                self.leaders_at[market] = now
            try:
                (self._kr if market == "KR" else self._us)(conn, now, leaders, open_now)
                self._status(conn, market, now, None)
            except Exception as e:
                log.warning("섹터 동향(%s) 갱신 실패: %s", market, e)
                self._status(conn, market, now, str(e)[:200])

    def _kr(self, conn: psycopg.Connection, now: datetime, leaders: bool, open_now: bool) -> None:
        rows = self.kiwoom.all_sectors()
        if leaders:
            for i, r in enumerate(rows):
                try:
                    r.leaders = self.kiwoom.sector_leaders(r.code)
                except Exception as e:
                    # 한 번 실패하면 이번에는 나머지도 건너뛰어요(같은 이유로 실패할 테니까요).
                    log.warning("섹터 %s 종목 받기 실패, 이번엔 건너뛰어요: %s", r.name, e)
                    break
        db.save_sectors(conn, "KR", rows)
        kst = now.astimezone(KST)
        stamp = f"{kst.date()}:{'open' if open_now else 'closed'}"
        if self.history_on != stamp:
            base = kst.strftime("%Y%m%d")
            for r in rows:
                try:
                    db.save_sector_daily(conn, "KR", r.code, self.kiwoom.sector_daily(r.code, base, r.price))
                except Exception as e:
                    log.warning("섹터 %s 지난 종가 실패: %s", r.name, e)
            self.history_on = stamp

    def _us(self, conn: psycopg.Connection, now: datetime, leaders: bool, open_now: bool) -> None:
        rows, failed = [], []
        for code, name, weight in sectors.US_SECTORS:
            try:
                candles = prices.yahoo_daily(code, self.http, "1y")
            except Exception as e:
                failed.append(f"{code}: {e}")
                continue
            closes = [c.close for c in candles]
            if not closes:
                continue
            db.save_sector_daily(conn, "US", code, [(c.day, c.close) for c in candles])
            r = sectors.Sector("US", code, name, closes[-1], sectors.day_change(closes), Decimal(str(weight)))
            if leaders:
                r.leaders = self._us_leaders(code)
            rows.append(r)
        db.save_sectors(conn, "US", rows)
        if failed and not rows:
            raise RuntimeError("; ".join(failed)[:200])

    def _us_leaders(self, code: str) -> list[dict]:
        out = []
        for t in sectors.US_TOP.get(code, []):
            try:
                closes = [c.close for c in prices.yahoo_daily(t, self.http, "5d")]
                out.append({"name": t, "pct": float(sectors.day_change(closes))})
            except Exception as e:
                log.warning("섹터 종목 %s 실패: %s", t, e)
        return sorted(out, key=lambda x: -abs(x["pct"]))[:2]

    def _status(self, conn: psycopg.Connection, market: str, now: datetime, error: str | None) -> None:
        status = db.get_setting(conn, "sectors_status") or {}
        status[market] = {"at": now.isoformat(), "ok": error is None, **({"error": error} if error else {})}
        db.set_setting(conn, "sectors_status", status)
