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


def test_expiry_days_follow_the_rules():
    events = calendar.expiry_events(date(2026, 11, 1), days=60)
    got = [(e.day, e.market, e.title) for e in events]
    # 11월 둘째 목요일 = 11.12, 12월은 동시만기(12.10)와 미국 셋째 금요일(12.18)
    assert (date(2026, 11, 12), "KR", "국내 옵션 만기") in got
    assert (date(2026, 12, 10), "KR", "국내 선물·옵션 동시만기") in got
    assert (date(2026, 12, 18), "US", "미국 쿼드러플 위칭(선물·옵션 동시만기)") in got


def test_policy_events_include_fomc_and_bok_with_korean_time():
    events = calendar.policy_events(date(2026, 10, 20), days=40)
    fomc = next(e for e in events if e.title == "FOMC 금리 결정")
    assert fomc.day == date(2026, 10, 28) and "한국 시간 다음 날 03:00" in fomc.detail
    assert any(e.title == "한국은행 기준금리 결정" and e.day == date(2026, 10, 22) for e in events)


def test_fred_release_events_keep_future_dates_and_convert_time():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.params["release_id"])
        assert req.url.params["include_release_dates_with_no_data"] == "true"
        return httpx.Response(200, json={"release_dates": [{"release_id": 10, "date": "2026-10-01"}, {"release_id": 10, "date": "2026-11-12"}]})

    events = calendar.fred_release_events("k", date(2026, 10, 20), httpx.Client(transport=httpx.MockTransport(handler)))
    cpi = [e for e in events if e.title.startswith("미국 CPI")]
    assert [e.day for e in cpi] == [date(2026, 11, 12)]
    assert cpi[0].detail == "미국 동부 08:30 · 한국 시간 22:30" and cpi[0].kind == "economic"
    assert len(seen) == len(calendar.US_RELEASES)
