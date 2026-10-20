from datetime import date, datetime, timezone
from decimal import Decimal

import httpx

from app import dividends
from app.dividends import Dividend, dividend_event, last_year, next_ex_date, parse_yahoo_dividends

D = Decimal


def ts(y, m, d):
    return int(datetime(y, m, d, 14, 30, tzinfo=timezone.utc).timestamp())


def test_parse_dates_in_market_zone():
    body = {"chart": {"result": [{"events": {"dividends": {
        "1": {"amount": 361, "date": ts(2026, 3, 30)}, "2": {"amount": 361, "date": ts(2025, 12, 29)}}}}]}}
    assert parse_yahoo_dividends(body, "KR") == [Dividend(date(2025, 12, 29), D(361)), Dividend(date(2026, 3, 30), D(361))]
    assert parse_yahoo_dividends({"chart": {"result": [{}]}}, "US") == []


QUARTERLY = [Dividend(date(2025, 11, 10), D("0.25")), Dividend(date(2026, 2, 9), D("0.25")),
             Dividend(date(2026, 5, 11), D("0.26")), Dividend(date(2026, 8, 10), D("0.26"))]


def test_projects_next_quarter_from_gaps():
    day, amount, guess = next_ex_date(QUARTERLY, date(2026, 10, 20))
    assert guess and amount == D("0.26") and date(2026, 11, 5) <= day <= date(2026, 11, 12)
    assert last_year(QUARTERLY, date(2026, 10, 20)) == D("1.02")


def test_announced_date_wins_and_stale_payers_are_skipped():
    announced = QUARTERLY + [Dividend(date(2026, 11, 9), D("0.27"))]
    assert next_ex_date(announced, date(2026, 10, 20)) == (date(2026, 11, 9), D("0.27"), False)
    assert next_ex_date([Dividend(date(2024, 6, 1), D(1))], date(2026, 10, 20)) is None
    assert next_ex_date([], date(2026, 10, 20)) is None


def test_event_text():
    e = dividend_event("KO", "코카콜라", "US", D(10), QUARTERLY, date(2026, 10, 20))
    assert e.kind == "dividend" and e.title == "코카콜라 배당락 (예상)"
    assert e.detail == "주당 $0.26 기준 짐작 · 받을 배당 약 $2.60 (세전)"


def test_kr_falls_back_to_kosdaq():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.path.rsplit("/", 1)[-1])
        if req.url.path.endswith(".KS"):
            return httpx.Response(404, json={"chart": {"result": None, "error": {"description": "No data found"}}})
        return httpx.Response(200, json={"chart": {"result": [{"events": {"dividends": {"1": {"amount": 100, "date": ts(2026, 3, 30)}}}}]}})

    out = dividends.yahoo_dividends("196170", "KR", httpx.Client(transport=httpx.MockTransport(handler)))
    assert seen == ["196170.KS", "196170.KQ"] and out[0].amount == D(100)
