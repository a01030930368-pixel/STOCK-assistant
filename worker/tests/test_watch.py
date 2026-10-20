import json
from decimal import Decimal

import httpx
import pytest

from app import watch
from app.kiwoom import KiwoomClient
from app.watch import Quote, parse_kr_quote, parse_kr_sector, parse_yahoo_quote


def test_parse_kr_quote_strips_sign():
    assert parse_kr_quote("005930", {"cur_prc": "-61200", "flu_rt": "-1.29"}) == Quote("005930", Decimal(61200), Decimal("-1.29"))


def test_parse_kr_quote_rejects_empty():
    with pytest.raises(ValueError):
        parse_kr_quote("005930", {"cur_prc": ""})


def test_parse_yahoo_quote_change_from_previous_close():
    body = {"chart": {"result": [{"meta": {"regularMarketPrice": 42.1, "chartPreviousClose": 41.1}}]}}
    q = parse_yahoo_quote("PLTR", body)
    assert q.price == Decimal("42.1") and q.change_pct == Decimal("2.43")


def test_parse_kr_sector_reports_keys_when_missing():
    assert parse_kr_sector({"upName": " 전기전자 "}) == "전기전자"
    with pytest.raises(ValueError, match="code, name"):
        parse_kr_sector({"name": "삼성전자", "code": "005930"})


def test_finnhub_sector_sends_key_in_header_and_translates():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["X-Finnhub-Token"] == "k" and "token" not in req.url.params
        return httpx.Response(200, json={"finnhubIndustry": "Semiconductors"})

    assert watch.finnhub_sector("nvda", "k", httpx.Client(transport=httpx.MockTransport(handler))) == "반도체"


def test_kiwoom_quote_and_sector_tr_ids():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231235959", "return_code": 0})
        seen.append((req.url.path, req.headers["api-id"], json.loads(req.content)["stk_cd"]))
        return httpx.Response(200, json={"cur_prc": "+61200", "flu_rt": "+0.8", "upName": "전기전자", "return_code": 0})

    client = KiwoomClient("https://api.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    assert client.kr_quote("005930").price == Decimal(61200)
    assert client.kr_sector("005930") == "전기전자"
    assert seen == [("/api/dostk/stkinfo", "ka10001", "005930"), ("/api/dostk/stkinfo", "ka10100", "005930")]
