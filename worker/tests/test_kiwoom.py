from decimal import Decimal

import httpx

import pytest

from app.kiwoom import (
    KiwoomClient,
    parse_balance,
    parse_kr_cash,
    parse_number,
    parse_price,
    parse_us_balance,
    parse_us_cash,
    split_ticker,
)

SAMPLE = {
    "tot_pur_amt": "000000001400000",
    "tot_evlt_amt": "000000001500000",
    "tot_evlt_pl": "000000000100000",
    "tot_prft_rt": "7.14",
    "prsm_dpst_aset_amt": "000000002000000",
    "acnt_evlt_remn_indv_tot": [
        {
            "stk_cd": "A005930", "stk_nm": "삼성전자", "rmnd_qty": "000000000020",
            "pur_pric": "000000070000", "cur_prc": "+000000075000", "evlt_amt": "000000001500000",
            "evltv_prft": "000000000100000", "prft_rt": "7.14",
        },
        {
            "stk_cd": "A000660", "stk_nm": "SK하이닉스", "rmnd_qty": "000000000000",
            "pur_pric": "0", "cur_prc": "-000000200000", "evlt_amt": "0", "evltv_prft": "0", "prft_rt": "0",
        },
    ],
    "return_code": 0,
    "return_msg": "조회가 완료되었습니다",
}


def test_parse_number_handles_padding_and_signs():
    assert parse_number("000000070000") == Decimal(70000)
    assert parse_number("-000000012") == Decimal(-12)
    assert parse_number("") == Decimal(0)
    assert parse_number("7.14") == Decimal("7.14")


def test_price_drops_change_sign():
    assert parse_price("-000000200000") == Decimal(200000)


def test_split_ticker_strips_prefix():
    assert split_ticker("A005930") == "005930"
    assert split_ticker("005930") == "005930"


def test_parse_balance_skips_empty_rows():
    balance = parse_balance(SAMPLE)
    assert [h.ticker for h in balance.holdings] == ["005930"]
    h = balance.holdings[0]
    assert (h.quantity, h.avg_price, h.cur_price, h.pnl_pct) == (20, 70000, 75000, Decimal("7.14"))
    assert balance.total_eval == 1500000


def test_client_reuses_token_and_sends_headers():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "T", "token_type": "bearer", "expires_dt": "29991231235959"})
        return httpx.Response(200, json=SAMPLE)

    client = KiwoomClient("https://mockapi.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    client.domestic_balance()
    client.domestic_balance()
    assert [c.url.path for c in calls] == ["/oauth2/token", "/api/dostk/acnt", "/api/dostk/acnt"]
    assert calls[1].headers["api-id"] == "kt00018"
    assert calls[1].headers["authorization"] == "Bearer T"


def test_token_error_reports_kiwoom_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"return_code": 3, "return_msg": "앱키가 유효하지 않습니다"})

    client = KiwoomClient("https://mockapi.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        client.domestic_balance()
    except RuntimeError as e:
        assert "앱키가 유효하지 않습니다" in str(e)
    else:
        raise AssertionError("expected RuntimeError")


US_SAMPLE = {
    "crnc_code": "USD",
    "tot_evlt_amt": "4588.2000",
    "tot_prch_amt": "4200.5000",
    "tot_pl_amt": "387.7000",
    "tot_pl_rt": "9.23",
    "result_list": [
        {
            "stex_nm": "미국", "crnc_code": "USD", "stk_cd": "AAPL", "frgn_stk_nm": "애플",
            "poss_qty": "000000000020", "frgn_stk_book_uv": "210.0250", "now_pric": "229.4100",
            "evlt_amt": "4588.2000", "pl_amt": "387.7000", "pl_rt": "9.23", "exch_rate": "1375.25",
        },
        {
            "stex_nm": "미국", "crnc_code": "USD", "stk_cd": "TSLA", "frgn_stk_nm": "테슬라",
            "poss_qty": "000000000000", "frgn_stk_book_uv": "0", "now_pric": "250", "evlt_amt": "0",
            "pl_amt": "0", "pl_rt": "0", "exch_rate": "1375.25",
        },
    ],
    "return_code": 0,
}


def test_parse_us_balance():
    balance = parse_us_balance(US_SAMPLE)
    assert [h.ticker for h in balance.holdings] == ["AAPL"]
    aapl = balance.holdings[0]
    assert aapl.name == "애플"
    assert aapl.quantity == Decimal(20)
    assert aapl.avg_price == Decimal("210.0250")
    assert aapl.cur_price == Decimal("229.4100")
    assert aapl.pnl_pct == Decimal("9.23")
    assert balance.total_eval == Decimal("4588.2000")
    assert balance.exch_rate == Decimal("1375.25")


def test_parse_us_balance_empty_account():
    balance = parse_us_balance({"result_list": [], "return_code": 0})
    assert balance.holdings == []
    assert balance.exch_rate == Decimal(0)


def test_us_balance_calls_ust21070():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231235959", "return_code": 0})
        seen.append((request.url.path, request.headers["api-id"]))
        return httpx.Response(200, json=US_SAMPLE)

    client = KiwoomClient("https://api.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    assert client.us_balance().holdings[0].ticker == "AAPL"
    assert seen == [("/api/us/acnt", "ust21070")]


def test_parse_kr_cash():
    cash = parse_kr_cash({"entr": "000000001250000", "d2_entra": "000000001180000", "ord_alow_amt": "000000001180000", "return_code": 0})
    assert cash.currency == "KRW"
    assert cash.deposit == Decimal(1250000)
    assert cash.d2_deposit == Decimal(1180000)
    assert cash.orderable == Decimal(1180000)


def test_parse_us_cash_reads_usd_row_not_krw_deposit():
    # 공식 응답 모양: 맨 위 krw_entra는 원화, 달러는 result_list의 USD 줄
    body = {"krw_entra": "000000000001003", "ch_uncla": "000000000000000", "result_list": [
        {"crnc_code": "GBP", "fc_entra": "0.00", "fc_ord_alowa": "150.00"},
        {"crnc_code": "USD", "crnc_nm": "미국달러", "fc_entra": "423.28", "fc_pymn_alowa": "423.28",
         "fc_booka": "000000000042328", "fc_ord_alowa": "200.78"},
    ], "return_code": 0}
    cash = parse_us_cash(body)
    assert cash.currency == "USD"
    assert cash.deposit == Decimal("423.28")
    assert cash.d2_deposit is None
    assert cash.orderable == Decimal("200.78")


def test_parse_us_cash_reports_key_names_only():
    with pytest.raises(ValueError) as err:
        parse_us_cash({"krw_entra": "123.45", "result_list": [{"crnc_code": "JPY", "fc_entra": "9"}], "return_code": 0})
    assert "krw_entra" in str(err.value)
    assert "123.45" not in str(err.value)


def test_cash_calls_kt00001_and_ust21110():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231235959", "return_code": 0})
        seen.append((request.url.path, request.headers["api-id"]))
        return httpx.Response(200, json={"entr": "1000", "result_list": [{"crnc_code": "USD", "fc_entra": "1000"}], "return_code": 0})

    client = KiwoomClient("https://api.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    assert client.kr_cash().deposit == Decimal(1000)
    assert client.us_cash().deposit == Decimal(1000)
    assert seen == [("/api/dostk/acnt", "kt00001"), ("/api/us/acnt", "ust21110")]


def _client(handler):
    return KiwoomClient("https://api.kiwoom.com", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))


def test_token_expiry_is_read_as_korean_time(monkeypatch):
    # 키움의 expires_dt는 한국 시간입니다. 컨테이너가 UTC여도 만료 9시간 전에 다시 받아야 해요.
    from datetime import datetime as real_datetime, timedelta, timezone
    import app.kiwoom as kw

    kst_now = real_datetime(2026, 10, 20, 9, 0, tzinfo=kw.KST)

    class Fixed(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return kst_now.astimezone(tz) if tz else kst_now.astimezone(timezone.utc).replace(tzinfo=None)

    monkeypatch.setattr(kw, "datetime", Fixed)
    tokens = []

    def handler(request):
        if request.url.path == "/oauth2/token":
            tokens.append(1)
            # 이미 5분 전에 만료된 토큰(한국 시간 08:55)
            return httpx.Response(200, json={"token": f"T{len(tokens)}", "expires_dt": "20261020085500"})
        return httpx.Response(200, json=SAMPLE)

    client = _client(handler)
    client.domestic_balance()
    client.domestic_balance()
    assert len(tokens) == 2


def test_bad_token_is_refreshed_once():
    tokens, calls = [], []

    def handler(request):
        if request.url.path == "/oauth2/token":
            tokens.append(1)
            return httpx.Response(200, json={"token": f"T{len(tokens)}", "expires_dt": "29991231235959"})
        calls.append(request.headers["authorization"])
        if request.headers["authorization"] == "Bearer T1":
            return httpx.Response(200, json={"return_code": 3, "return_msg": "[8005:Token이 유효하지 않습니다]"})
        return httpx.Response(200, json=SAMPLE)

    _client(handler).domestic_balance()
    assert calls == ["Bearer T1", "Bearer T2"]


def test_balance_reads_every_page():
    page2 = dict(SAMPLE, acnt_evlt_remn_indv_tot=[dict(SAMPLE["acnt_evlt_remn_indv_tot"][0], stk_cd="A035420", stk_nm="NAVER")])

    def handler(request):
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "T", "expires_dt": "29991231235959"})
        if request.headers.get("next-key"):
            return httpx.Response(200, json=page2)
        return httpx.Response(200, json=SAMPLE, headers={"cont-yn": "Y", "next-key": "K"})

    assert [h.ticker for h in _client(handler).domestic_balance().holdings] == ["005930", "035420"]
