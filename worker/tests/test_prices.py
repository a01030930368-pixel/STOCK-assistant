from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.kiwoom import KiwoomClient
from app import prices
from app.prices import Candle, parse_kr_daily, parse_stooq, parse_yahoo_daily

D = Decimal


def test_parse_kr_daily_sorts_and_drops_signs():
    body = {"stk_dt_pole_chart_qry": [
        {"dt": "20261017", "cur_prc": "+68400", "open_pric": "+67000", "high_pric": "+69000", "low_pric": "-66500", "trde_qty": "1200"},
        {"dt": "20261016", "cur_prc": "-67900"},
        {"dt": "", "cur_prc": "1"},
    ]}
    assert parse_kr_daily(body) == [
        Candle(date(2026, 10, 16), D(67900), D(67900), D(67900), D(67900), D(0)),
        Candle(date(2026, 10, 17), D(67000), D(69000), D(66500), D(68400), D(1200)),
    ]


def test_parse_stooq_csv():
    text = "Date,Open,High,Low,Close,Volume\n2026-10-16,40,42,39,41.1,100\n2026-10-15,38,40,37,39.5,90\n"
    assert parse_stooq(text) == [
        Candle(date(2026, 10, 15), D(38), D(40), D(37), D("39.5"), D(90)),
        Candle(date(2026, 10, 16), D(40), D(42), D(39), D("41.1"), D(100)),
    ]


def test_parse_stooq_reports_non_csv():
    with pytest.raises(ValueError, match="CSV"):
        parse_stooq("Exceeded the daily hits limit")


def test_kr_daily_calls_ka10081():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231235959", "return_code": 0})
        seen.append((request.url.path, request.headers["api-id"]))
        return httpx.Response(200, json={"stk_dt_pole_chart_qry": [{"dt": "20261017", "cur_prc": "68400"}], "return_code": 0})

    client = KiwoomClient("https://api.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    assert [(c.day, c.close) for c in client.kr_daily("005930", "20261019")] == [(date(2026, 10, 17), D(68400))]
    assert seen == [("/api/dostk/chart", "ka10081")]


def test_parse_yahoo_daily_uses_new_york_dates():
    # 2025-10-15, 10-16 09:30 ET
    body = {"chart": {"result": [{"timestamp": [1760535000, 1760621400], "indicators": {"quote": [
        {"open": [38, 40], "high": [40, 42], "low": [37, 39], "close": [39.5, 41.1], "volume": [90, 100]}]}}]}}
    assert parse_yahoo_daily(body) == [
        Candle(date(2025, 10, 15), D(38), D(40), D(37), D("39.5"), D(90)),
        Candle(date(2025, 10, 16), D(40), D(42), D(39), D("41.1"), D(100)),
    ]


def test_us_daily_falls_back_to_stooq():
    def handler(req: httpx.Request) -> httpx.Response:
        if "yahoo" in req.url.host:
            return httpx.Response(429)
        return httpx.Response(200, text="Date,Open,High,Low,Close,Volume\n2026-10-16,40,42,39,41.1,100\n")

    out = prices.us_daily("SOUN", httpx.Client(transport=httpx.MockTransport(handler)))
    assert [c.day for c in out] == [date(2026, 10, 16)]
