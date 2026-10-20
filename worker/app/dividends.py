"""배당 기록과 다음 배당락 예상. 야후 차트의 배당 기록(키 없음)을 씁니다.

국내 종목은 야후에서 005930.KS(코스피) 또는 .KQ(코스닥)로 찾습니다.
다음 배당락일은 발표된 날이 있으면 그 날을, 없으면 지난 배당 간격으로 짐작합니다(예상).
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from statistics import median
from zoneinfo import ZoneInfo

import httpx

from .calendar import Event
from .intraday import UA, YAHOO

ZONE = {"KR": ZoneInfo("Asia/Seoul"), "US": ZoneInfo("America/New_York")}


@dataclass(frozen=True)
class Dividend:
    ex_date: date
    amount: Decimal


def parse_yahoo_dividends(body: dict, market: str) -> list[Dividend]:
    result = ((body.get("chart") or {}).get("result") or [None])[0]
    if result is None:
        err = (body.get("chart") or {}).get("error") or {}
        raise ValueError(f"야후 배당 응답이 비어 있습니다: {err.get('description', '')[:60]}")
    raw = ((result.get("events") or {}).get("dividends") or {}).values()
    out = {}
    for d in raw:
        if d.get("amount") and d.get("date"):
            day = datetime.fromtimestamp(d["date"], timezone.utc).astimezone(ZONE[market]).date()
            out[day] = Dividend(day, round(Decimal(str(d["amount"])), 4))
    return [out[k] for k in sorted(out)]


def yahoo_dividends(ticker: str, market: str, http: httpx.Client) -> list[Dividend]:
    symbols = [f"{ticker}.KS", f"{ticker}.KQ"] if market == "KR" else [ticker.upper()]
    last: Exception | None = None
    for symbol in symbols:
        try:
            res = http.get(f"{YAHOO}{symbol}", params={"interval": "1d", "range": "3y", "events": "div"}, headers={"User-Agent": UA})
            res.raise_for_status()
            return parse_yahoo_dividends(res.json(), market)
        except Exception as e:  # 코스피에 없으면 코스닥으로 한 번 더
            last = e
    raise last  # type: ignore[misc]


def last_year(history: list[Dividend], today: date) -> Decimal:
    """최근 1년 주당 배당 합계"""
    return sum((d.amount for d in history if today - timedelta(days=365) < d.ex_date <= today), Decimal(0))


def next_ex_date(history: list[Dividend], today: date) -> tuple[date, Decimal, bool] | None:
    """(다음 배당락일, 주당 배당, 예상인지). 기록이 모자라거나 1년 넘게 안 줬으면 None."""
    future = [d for d in history if d.ex_date >= today]
    if future:
        return future[0].ex_date, future[0].amount, False
    past = [d for d in history if d.ex_date < today]
    if not past or today - past[-1].ex_date > timedelta(days=400):
        return None
    if len(past) >= 2:
        recent = past[-5:]
        gap = median((b.ex_date - a.ex_date).days for a, b in zip(recent, recent[1:]))
    else:
        gap = 365
    gap = max(25, int(gap))
    day = past[-1].ex_date
    while day < today:
        day += timedelta(days=gap)
    return day, past[-1].amount, True


def money(market: str, v: Decimal) -> str:
    return f"{v:,.0f}원" if market == "KR" else f"${v:,.2f}"


def dividend_event(ticker: str, name: str, market: str, quantity: Decimal, history: list[Dividend], today: date) -> Event | None:
    nxt = next_ex_date(history, today)
    if nxt is None or nxt[0] > today + timedelta(days=200):
        return None
    day, amount, guess = nxt
    title = f"{name} 배당락{' (예상)' if guess else ''}"
    detail = f"주당 {money(market, amount)}{' 기준 짐작' if guess else ''} · 받을 배당 약 {money(market, amount * quantity)} (세전)"
    return Event(day=day, kind="dividend", market=market, ticker=ticker, title=title, detail=detail)
