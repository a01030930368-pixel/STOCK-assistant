"""차트용 일봉(시가·고가·저가·종가·거래량). 국내는 키움 ka10081(주식일봉차트), 미국은 키 없이 쓰는 야후 파이낸스 차트(비공식)에서,
야후가 막히면 Stooq CSV에서 가져옵니다.

두 곳 모두 실패해도, 워커가 장중에 보유 종목 현재가를 그날 종가로 계속 쌓으므로 차트는 날마다 채워집니다.
"""
import csv
import io
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx

from . import intraday

STOOQ = "https://stooq.com/q/d/l/"
NY = ZoneInfo("America/New_York")
KEEP_DAYS = 800  # 120일 이동평균과 2~3년 주봉·월봉을 그릴 만큼


@dataclass(frozen=True)
class Candle:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal | None


def parse_kr_daily(body: dict) -> list[Candle]:
    from .kiwoom import parse_number, parse_price  # kiwoom이 이 모듈을 쓰므로 함수 안에서 가져옵니다.

    out = []
    for row in body.get("stk_dt_pole_chart_qry") or []:
        day, close = str(row.get("dt", "")).strip(), parse_price(row.get("cur_prc"))
        if len(day) != 8 or close <= 0:
            continue
        o, h, l = (parse_price(row.get(k)) or close for k in ("open_pric", "high_pric", "low_pric"))
        out.append(Candle(date(int(day[:4]), int(day[4:6]), int(day[6:])), o, max(h, close), min(l, close), close,
                          abs(parse_number(row.get("trde_qty")))))
    return sorted(out, key=lambda c: c.day)[-KEEP_DAYS:]


def parse_stooq(text: str) -> list[Candle]:
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            close = Decimal(row["Close"])
            out.append(Candle(date.fromisoformat(row["Date"]), Decimal(row.get("Open") or close), Decimal(row.get("High") or close),
                              Decimal(row.get("Low") or close), close, Decimal(row["Volume"]) if row.get("Volume") else None))
        except (KeyError, ValueError, ArithmeticError):
            continue
    if not out and text.strip():
        # 한도 초과 등 CSV가 아닌 안내문이 오면 앞부분만 오류로 남깁니다.
        raise ValueError(f"Stooq 응답이 CSV가 아닙니다: {text.strip()[:60]}")
    return sorted(out, key=lambda c: c.day)[-KEEP_DAYS:]


def stooq_daily(ticker: str, http: httpx.Client) -> list[Candle]:
    res = http.get(STOOQ, params={"s": f"{ticker.lower()}.us", "i": "d"})
    res.raise_for_status()
    return parse_stooq(res.text)


def parse_yahoo_daily(body: dict) -> list[Candle]:
    # 야후 일봉의 시각은 그날 장 시작 시각이라 뉴욕 날짜로 바꿉니다.
    out = {b.ts.astimezone(NY).date(): b for b in intraday.parse_yahoo(body)}
    return [Candle(d, b.open, b.high, b.low, b.close, b.volume) for d, b in sorted(out.items())][-KEEP_DAYS:]


def yahoo_daily(ticker: str, http: httpx.Client, span: str = "5y") -> list[Candle]:
    res = http.get(f"{intraday.YAHOO}{ticker.upper()}", params={"interval": "1d", "range": span},
                   headers={"User-Agent": intraday.UA})
    res.raise_for_status()
    return parse_yahoo_daily(res.json())


def us_daily(ticker: str, http: httpx.Client) -> list[Candle]:
    """야후를 먼저 쓰고, 실패하면 Stooq로 한 번 더 시도합니다."""
    try:
        return yahoo_daily(ticker, http)
    except Exception as first:
        try:
            return stooq_daily(ticker, http)
        except Exception as second:
            raise RuntimeError(f"야후: {first} / Stooq: {second}") from second
