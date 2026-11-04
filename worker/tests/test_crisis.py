from datetime import date, datetime, timezone

import httpx

from app import crisis


def _body(days: list[date], closes: list[float], tz: str = "Asia/Seoul") -> dict:
    ts = [int(datetime(d.year, d.month, d.day, 1, 0, tzinfo=timezone.utc).timestamp()) for d in days]
    return {"chart": {"result": [{"meta": {"exchangeTimezoneName": tz}, "timestamp": ts,
                                   "indicators": {"quote": [{"open": closes, "high": closes, "low": closes, "close": closes,
                                                             "volume": [0] * len(closes)}]}}]}}


def test_symbols():
    assert crisis.symbols("KOSPI", "IDX") == ["^KS11"]
    assert crisis.symbols("005930", "KR") == ["005930.KS", "005930.KQ"]
    assert crisis.symbols("BRK.B", "US") == ["BRK-B"]


def test_fetch_tries_kosdaq_and_clips_dates():
    asked = []

    def handler(req: httpx.Request) -> httpx.Response:
        sym = req.url.path.rsplit("/", 1)[-1]
        asked.append(sym)
        if sym.endswith(".KS"):
            return httpx.Response(404)
        return httpx.Response(200, json=_body([date(2020, 1, 1), date(2020, 2, 14), date(2020, 2, 17), date(2021, 1, 4)], [9, 10, 11, 12]))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    rows = crisis.fetch(http, "247540", "KR", date(2020, 2, 17), date(2020, 12, 30))
    assert asked == ["247540.KS", "247540.KQ"]
    assert [d for d, _ in rows] == [date(2020, 2, 14), date(2020, 2, 17)]  # 10일 앞부터, 끝 뒤는 빼요


def test_fetch_not_listed_then_is_empty():
    http = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(404)))
    assert crisis.fetch(http, "999999", "KR", date(2020, 2, 17), date(2020, 5, 15)) == []


def test_period_has_lead():
    p = crisis.period(date(2020, 2, 17), date(2020, 5, 15))
    assert datetime.fromtimestamp(p["period1"], timezone.utc).date() == date(2020, 2, 7)
    assert datetime.fromtimestamp(p["period2"], timezone.utc).date() == date(2020, 5, 16)
