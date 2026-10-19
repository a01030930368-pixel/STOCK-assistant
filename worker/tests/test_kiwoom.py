from decimal import Decimal

import httpx

from app.kiwoom import KiwoomClient, parse_balance, parse_number, parse_price, parse_us_balance, split_ticker

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
