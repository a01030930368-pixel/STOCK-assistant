from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.kiwoom import KiwoomClient
from app.prices import parse_kr_daily, parse_stooq


def test_parse_kr_daily_sorts_and_drops_signs():
    body = {"stk_dt_pole_chart_qry": [
        {"dt": "20261017", "cur_prc": "+68400"},
        {"dt": "20261016", "cur_prc": "-67900"},
        {"dt": "", "cur_prc": "1"},
    ]}
    assert parse_kr_daily(body) == [(date(2026, 10, 16), Decimal(67900)), (date(2026, 10, 17), Decimal(68400))]


def test_parse_stooq_csv():
    text = "Date,Open,High,Low,Close,Volume\n2026-10-16,40,42,39,41.1,100\n2026-10-15,38,40,37,39.5,90\n"
    assert parse_stooq(text) == [(date(2026, 10, 15), Decimal("39.5")), (date(2026, 10, 16), Decimal("41.1"))]


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
    assert client.kr_daily("005930", "20261019") == [(date(2026, 10, 17), Decimal(68400))]
    assert seen == [("/api/dostk/chart", "ka10081")]
