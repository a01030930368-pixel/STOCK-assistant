"""미국 프리·애프터마켓 시세. 야후 1분봉(includePrePost)에서 정규장 밖 마지막 가격을 읽어 보유 종목 화면에 붙입니다."""
import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import httpx
import psycopg

from . import db, intraday
from .calendar import is_holiday
from .market import NY

log = logging.getLogger("worker")

EVERY = timedelta(minutes=5)
# 뉴욕 시간. 프리 04:00–09:30, 애프터 16:00–20:00
SESSIONS = {"pre": (time(4, 0), time(9, 30)), "post": (time(16, 0), time(20, 0))}


@dataclass(frozen=True)
class ExtQuote:
    ticker: str
    session: str
    price: Decimal
    base: Decimal  # 정규장 종가(프리면 전날, 애프터면 그날)
    at: datetime


def session_at(now: datetime) -> str | None:
    local = now.astimezone(NY)
    if local.weekday() >= 5 or is_holiday("US", local.date()):
        return None
    for name, (start, end) in SESSIONS.items():
        if start <= local.time() < end:
            return name
    return None


def parse_ext(body: dict, ticker: str) -> ExtQuote | None:
    """오늘 프리·애프터 구간의 마지막 1분봉. 그 구간에 거래가 없으면 None."""
    result = ((body.get("chart") or {}).get("result") or [None])[0] or {}
    meta = result.get("meta") or {}
    base = meta.get("regularMarketPrice")
    periods = meta.get("currentTradingPeriod") or {}
    if not base:
        return None
    windows = []
    for name in ("pre", "post"):
        p = periods.get(name) or {}
        if p.get("start") and p.get("end"):
            windows.append((name, datetime.fromtimestamp(p["start"], timezone.utc), datetime.fromtimestamp(p["end"], timezone.utc)))
    last = None
    for bar in intraday.parse_yahoo(body):
        for name, start, end in windows:
            if start <= bar.ts < end:
                last = ExtQuote(ticker, name, bar.close, round(Decimal(str(base)), 4), bar.ts)
    return last


def fetch_ext(ticker: str, http: httpx.Client) -> ExtQuote | None:
    res = http.get(f"{intraday.YAHOO}{ticker.upper()}", params={"interval": "1m", "range": "1d", "includePrePost": "true"},
                   headers={"User-Agent": intraday.UA})
    res.raise_for_status()
    return parse_ext(res.json(), ticker)


class ExtJob:
    def __init__(self, http: httpx.Client):
        self.http = http
        self.last: datetime | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        session = session_at(now)
        if session is None or (self.last and now - self.last < EVERY):
            return
        self.last = now
        tickers = db.us_held_tickers(conn)
        got, errors = 0, []
        for t in tickers:
            try:
                q = fetch_ext(t, self.http)
            except Exception as e:
                errors.append(f"{t}: {str(e)[:80]}")
                continue
            # 지금 구간에 거래가 아직 없으면(프리 막 시작) 예전 값을 지워 헷갈리지 않게 해요.
            if q is None or q.session != session:
                db.delete_ext_quote(conn, t)
                continue
            db.save_ext_quote(conn, q)
            got += 1
        db.set_setting(conn, "ext_status", {"at": now.isoformat(), "session": session, "got": got, "error": "; ".join(errors)[:300] or None})
        if errors:
            log.warning("장외 시세 일부 실패: %s", "; ".join(errors)[:300])
