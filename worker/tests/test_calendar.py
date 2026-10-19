from datetime import date

import httpx

from app import calendar


def test_holiday_events_cover_both_markets_in_korean():
    events = calendar.holiday_events(date(2026, 11, 1), days=60)
    titles = {(e.day, e.market): e.title for e in events}
    assert titles[(date(2026, 11, 26), "US")] == "미국 휴장 · 추수감사절"
    assert titles[(date(2026, 12, 25), "KR")].startswith("한국 휴장 · ")
    assert all(date(2026, 11, 1) <= e.day <= date(2026, 12, 31) for e in events)


def test_observed_us_holiday_name():
    assert calendar._us_name("Independence Day (observed)") == "독립기념일 대체 휴장"


def test_finnhub_earnings_calendar():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/calendar/earnings")
        assert request.url.params["symbol"] == "IONQ"
        return httpx.Response(200, json={"earningsCalendar": [
            {"date": "2026-11-05", "epsEstimate": -0.3, "hour": "amc", "quarter": 3, "year": 2026, "symbol": "IONQ"},
            {"date": None, "symbol": "IONQ"},
        ]})

    [e] = calendar.finnhub_earnings_calendar("IONQ", "아이온큐", "KEY", date(2026, 10, 19), httpx.Client(transport=httpx.MockTransport(handler)))
    assert e.day == date(2026, 11, 5) and e.kind == "earnings" and e.market == "US"
    assert e.title == "아이온큐 실적 발표"
    assert e.detail == "2026년 3분기 · 장 마감 후 · 예상 EPS -0.3"
