"""차트용 일봉 종가. 국내는 키움 ka10081(주식일봉차트), 미국은 키 없이 쓰는 Stooq CSV에서 가져옵니다.

두 곳 모두 실패해도, 워커가 장중에 보유 종목 현재가를 그날 종가로 계속 쌓으므로 차트는 날마다 채워집니다.
"""
import csv
import io
from datetime import date
from decimal import Decimal

import httpx

STOOQ = "https://stooq.com/q/d/l/"
KEEP_DAYS = 400


def parse_kr_daily(body: dict) -> list[tuple[date, Decimal]]:
    from .kiwoom import parse_price  # kiwoom이 이 모듈을 쓰므로 함수 안에서 가져옵니다.

    out = []
    for row in body.get("stk_dt_pole_chart_qry") or []:
        day, close = str(row.get("dt", "")).strip(), parse_price(row.get("cur_prc"))
        if len(day) == 8 and close > 0:
            out.append((date(int(day[:4]), int(day[4:6]), int(day[6:])), close))
    return sorted(out)[-KEEP_DAYS:]


def parse_stooq(text: str) -> list[tuple[date, Decimal]]:
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            out.append((date.fromisoformat(row["Date"]), Decimal(row["Close"])))
        except (KeyError, ValueError, ArithmeticError):
            continue
    if not out and text.strip():
        # 한도 초과 등 CSV가 아닌 안내문이 오면 앞부분만 오류로 남깁니다.
        raise ValueError(f"Stooq 응답이 CSV가 아닙니다: {text.strip()[:60]}")
    return sorted(out)[-KEEP_DAYS:]


def stooq_daily(ticker: str, http: httpx.Client) -> list[tuple[date, Decimal]]:
    res = http.get(STOOQ, params={"s": f"{ticker.lower()}.us", "i": "d"})
    res.raise_for_status()
    return parse_stooq(res.text)
