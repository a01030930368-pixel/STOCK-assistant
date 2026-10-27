"""종목 화면의 실시간 가격 줄. 화면이 열려 있는 동안 몇 초마다 그 종목 현재가를 받아요.

화면은 app_settings 'live:<종목>'에 seen(마지막으로 본 시각)을 남기고, 이 줄은 최근 SEEN_FOR 안에 본 종목만
장중엔 몇 초(국내 키움 ka10001, 미국 야후)마다, 장 밖에선 1분마다 받아 같은 자리에 price·change·at을 덧붙여요.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import psycopg
from psycopg.types.json import Jsonb

from . import watch
from .market import kr_trading_now, us_trading_now

log = logging.getLogger("worker")

TICK = 1  # 이 줄이 깨는 간격(초)
EVERY = {"KR": 2, "US": 4}  # 장중 받는 간격(초). 키움은 요청 사이 0.25초를 지키고, 야후는 너무 자주 부르지 않아요.
CLOSED_EVERY = 60
SEEN_FOR = timedelta(seconds=30)  # 화면이 이만큼 소식이 없으면 그만 받아요
MAX_TICKERS = 4


def kr_change(body: dict) -> tuple[Decimal, Decimal | None, Decimal | None]:
    """ka10001 응답에서 현재가·전일 대비(원)·등락률. 값에 +/- 부호가 붙어 와요."""
    from .kiwoom import parse_number, parse_price

    price = parse_price(body.get("cur_prc"))
    if price <= 0:
        raise ValueError("키움 현재가가 비어 있어요")
    diff = body.get("pred_pre")
    rate = body.get("flu_rt")
    return price, parse_number(diff) if diff not in (None, "") else None, parse_number(rate) if rate not in (None, "") else None


def from_pct(price: Decimal, pct: Decimal | None) -> Decimal | None:
    """등락률만 있을 때 전일 대비 금액: 현재가 - 현재가 / (1 + 등락률)."""
    if pct is None or pct <= -100:
        return None
    return round(price - price / (1 + pct / 100), 4)


def due(rows: list[tuple[str, dict]], now: datetime, last: dict[str, float], mono: float) -> list[tuple[str, str]]:
    """지금 받아야 할 (종목, 시장). 최근에 본 것만, 시장별 간격이 지난 것만, 많아야 MAX_TICKERS개."""
    out = []
    for key, value in rows:
        ticker, market = key.split(":", 1)[1], value.get("market")
        if market not in EVERY:
            continue
        try:
            seen = datetime.fromisoformat(str(value.get("seen")))
        except ValueError:
            continue
        if now - seen > SEEN_FOR:
            continue
        open_now = kr_trading_now(now) if market == "KR" else us_trading_now(now)
        gap = EVERY[market] if open_now else CLOSED_EVERY
        if mono - last.get(ticker, -1e9) >= gap:
            out.append((ticker, market))
    return out[:MAX_TICKERS]


class LiveQuotes:
    def __init__(self, kiwoom, http: httpx.Client):
        self.kiwoom = kiwoom
        self.http = http
        self.last: dict[str, float] = {}

    def quote(self, ticker: str, market: str) -> dict:
        if market == "KR":
            if not self.kiwoom:
                raise RuntimeError("키움 키가 없어요")
            price, diff, pct = self.kiwoom.kr_price(ticker)
        else:
            q = watch.yahoo_quote(ticker, self.http)
            price, pct = q.price, q.change_pct
            diff = None
        if diff is None:
            diff = from_pct(price, pct)
        return {"price": float(price), "change": None if diff is None else float(diff), "change_pct": None if pct is None else float(pct)}

    def run_once(self, conn: psycopg.Connection, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        rows = conn.execute("SELECT key, value FROM app_settings WHERE key LIKE 'live:%'").fetchall()
        mono = time.monotonic()
        done = 0
        for ticker, market in due(rows, now, self.last, mono):
            self.last[ticker] = mono
            open_now = kr_trading_now(now) if market == "KR" else us_trading_now(now)
            try:
                extra = {**self.quote(ticker, market), "at": now.isoformat(), "open": open_now, "error": None}
            except Exception as e:
                log.warning("%s 실시간 가격 받기 실패: %s", ticker, e)
                extra = {"error": str(e)[:120], "error_at": now.isoformat()}
            # 화면이 쓰는 seen은 건드리지 않게 덧붙이기만 해요.
            conn.execute("UPDATE app_settings SET value = value || %s WHERE key = %s", (Jsonb(extra), f"live:{ticker}"))
            done += 1
        return done


def live_loop(kiwoom, db_conn) -> None:
    job = LiveQuotes(kiwoom, httpx.Client(timeout=10))
    while True:
        try:
            job.run_once(db_conn.get())
        except Exception:
            log.exception("실시간 가격 실패")
            db_conn.check()
            time.sleep(10)
        time.sleep(TICK)


def start(kiwoom, db_conn) -> None:
    threading.Thread(target=live_loop, args=(kiwoom, db_conn), name="live", daemon=True).start()
