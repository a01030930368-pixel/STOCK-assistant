import json
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx

from app import fills
from app.fills_job import FillsJob
from app.kiwoom import KiwoomClient

KR_ROW = {  # 키움 명세 예시(kt00015)
    "trde_dt": "20241121", "trde_no": "000000001", "rmrk_nm": "장내매도", "exct_amt": "000000000056798",
    "trde_kind_nm": "매매", "stk_nm": "삼성전자", "trde_amt": "000000000056900", "trde_agri_tax": "000000000000102",
    "io_tp": "1", "io_tp_nm": "매도", "stk_cd": "A005930", "trde_qty_jwa_cnt": "1", "cmsn": "000000000000000",
    "proc_tm": "08:12:35", "isin_cd": "KR7005930003", "trde_unit": "56,900", "cntr_dt": "20241119",
    "tax_sum_cmsn": "000000000000102",
}


def test_kr_fill_uses_fill_date_and_fees():
    [f] = fills.parse_kr_fills([KR_ROW])
    assert (f.market, f.day, f.ticker, f.side) == ("KR", date(2024, 11, 19), "005930", "sell")
    assert (f.quantity, f.price, f.fee, f.time) == (Decimal(1), Decimal(56900), Decimal(102), None)
    assert f.key == "KR:2024-11-19:005930:sell"


def test_kr_fill_skips_deposits_and_falls_back_to_amount():
    deposit = {**KR_ROW, "trde_kind_nm": "입출금", "io_tp_nm": "입금", "rmrk_nm": "이체입금", "stk_cd": ""}
    no_unit = {**KR_ROW, "trde_unit": "", "trde_qty_jwa_cnt": "2", "trde_amt": "000000000113800", "io_tp_nm": "매수"}
    other_kind = {**KR_ROW, "trde_kind_nm": "장내매매"}
    [f, g] = fills.parse_kr_fills([deposit, no_unit, other_kind])
    assert g.side == "sell"
    assert (f.side, f.price) == ("buy", Decimal(56900))


def test_kr_day_fill_from_kt00009():
    row = {"ord_no": "0000050", "stk_cd": "A069500", "trde_tp": "시장가", "io_tp_nm": "현금매수", "cntr_no": "0000001",
           "stk_nm": "KODEX 200", "cntr_qty": "0000000001", "cntr_uv": "0000004900", "cntr_tm": "13:07:47"}
    unfilled = {**row, "cntr_qty": "0000000000"}
    [f] = fills.parse_kr_day_fills(date(2026, 10, 20), [row, unfilled])
    assert (f.ticker, f.side, f.price, f.time, f.source) == ("069500", "buy", Decimal(4900), "13:07", "kt00009")


def test_us_fill_keeps_only_filled_orders():
    row = {"ord_dt": "20261017", "ord_time": "224130", "stk_cd": "nvda", "stk_nm": "NVIDIA", "slby_tp_nm": "매수",
           "cntr_qty": "3", "cntr_uv": "182.4000", "ord_no": "1"}
    [f] = fills.parse_us_fills([row, {**row, "cntr_qty": "0"}])
    assert (f.market, f.ticker, f.day, f.time, f.price) == ("US", "NVDA", date(2026, 10, 17), "22:41", Decimal("182.4"))


def test_group_merges_split_orders_with_weighted_price():
    a = fills.Fill("KR", date(2026, 10, 9), "005930", "삼성전자", "buy", Decimal(30), Decimal(61200), Decimal(140), "09:31", "kt00009")
    b = fills.Fill("KR", date(2026, 10, 9), "005930", "삼성전자", "buy", Decimal(20), Decimal(61300), None, "09:33", "kt00009")
    [g] = fills.group([b, a])
    assert (g.quantity, g.price, g.fee, g.time, g.count) == (Decimal(50), Decimal(61240), Decimal(140), "09:31", 2)


def test_chunks_cover_range_without_gaps():
    assert fills.chunks(date(2026, 7, 20), date(2026, 10, 20)) == [
        ("20260720", "20260819"), ("20260820", "20260919"), ("20260920", "20261020")]


def test_merge_prefers_kt00015_group():
    main = fills.parse_kr_fills([{**KR_ROW, "cntr_dt": "20261020"}])
    day = fills.parse_kr_day_fills(date(2026, 10, 20), [{"io_tp_nm": "현금매도", "stk_cd": "A005930", "cntr_qty": "1", "cntr_uv": "56900"},
                                                        {"io_tp_nm": "현금매수", "stk_cd": "A000660", "cntr_qty": "1", "cntr_uv": "212500"}])
    merged = FillsJob._merge(main + day)
    assert sorted((f.ticker, f.source) for f in merged) == [("000660", "kt00009"), ("005930", "kt00015")]


def test_post_pages_follows_next_key():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231000000", "return_code": 0})
        seen.append(req.headers.get("next-key"))
        if not req.headers.get("next-key"):
            return httpx.Response(200, headers={"cont-yn": "Y", "next-key": "K2"}, json={"return_code": 0, "result_list": [{"a": 1}]})
        return httpx.Response(200, headers={"cont-yn": "N"}, json={"return_code": 0, "result_list": [{"a": 2}]})

    client = KiwoomClient("https://x", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    rows = client._post_pages("/api/us/acnt", "ust21180", {}, "result_list")
    assert rows == [{"a": 1}, {"a": 2}] and seen == [None, "K2"]


class FakeKiwoom:
    def __init__(self):
        self.calls = []

    def kr_fills(self, start, end):
        self.calls.append(("kr", start, end))
        return []

    def us_fills(self, start, end, ticker=None):
        self.calls.append(("us", start, end))
        raise RuntimeError("키움 API 오류 ust21180: 모의투자 미지원")

    def kr_day_fills(self, day):
        self.calls.append(("day", day))
        return []


class FakeConn:
    pass


def test_job_backfills_three_months_then_recent(monkeypatch):
    store = {}
    monkeypatch.setattr("app.db.get_setting", lambda conn, key: store.get(key))
    monkeypatch.setattr("app.db.set_setting", lambda conn, key, value: store.__setitem__(key, dict(value)))
    monkeypatch.setattr("app.db.save_fills", lambda conn, rows: None)
    k = FakeKiwoom()
    job = FillsJob(k)
    job.run(FakeConn(), datetime(2026, 10, 20, 3, tzinfo=timezone.utc))
    assert store["fills_backfilled_v2"] == {"KR": True}  # 미국은 실패해서 다음에 다시 3개월
    assert store["fills_status"]["KR"]["ok"] and not store["fills_status"]["US"]["ok"]
    assert "모의투자 미지원" in store["fills_status"]["US"]["error"]
    assert [c for c in k.calls if c[0] == "kr"][0][1] == "20260720"
    assert len([c for c in k.calls if c[0] == "day"]) == 5
    k.calls.clear()
    job.run(FakeConn(), datetime(2026, 10, 20, 3, 10, tzinfo=timezone.utc))
    assert k.calls == []  # 30분이 안 지났음
    job.run(FakeConn(), datetime(2026, 10, 20, 3, 40, tzinfo=timezone.utc))
    assert [c[1] for c in k.calls if c[0] == "kr"] == ["20261010"]
    assert [c[1] for c in k.calls if c[0] == "us"][0] == "20260720"


def test_post_pages_treats_no_data_as_empty():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231000000", "return_code": 0})
        return httpx.Response(200, json={"return_code": 20, "return_msg": "[2000](501724:관련자료가없습니다)"})

    client = KiwoomClient("https://x", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    assert client._post_pages("/api/us/acnt", "ust21180", {}, "result_list") == []


def test_us_fills_sends_no_exchange_or_empty_ticker():
    sent = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth2/token":
            return httpx.Response(200, json={"token": "t", "expires_dt": "20991231000000", "return_code": 0})
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"return_code": 0, "result_list": []})

    client = KiwoomClient("https://x", "k", "s", httpx.Client(transport=httpx.MockTransport(handler)))
    client.us_fills("20261001", "20261020")
    client.us_fills("20261001", "20261020", "PLTR")
    assert sent == [{"strt_dt": "20261001", "end_dt": "20261020", "slby_tp": "0"},
                    {"strt_dt": "20261001", "end_dt": "20261020", "slby_tp": "0", "stk_cd": "PLTR"}]


class TickerKiwoom(FakeKiwoom):
    def us_fills(self, start, end, ticker=None):
        self.calls.append(("us", start, end, ticker))
        if not ticker:
            raise RuntimeError("키움 API 오류 ust21180: 파라미터=stk_cd 실패사유= 종목 코드값이 없습니다.")
        return []

    def kr_day_fills(self, day):
        raise RuntimeError("키움 API 오류 kt00009: 일시 오류")


def test_job_falls_back_to_per_ticker_and_survives_day_errors(monkeypatch):
    store = {}
    monkeypatch.setattr("app.db.get_setting", lambda conn, key: store.get(key))
    monkeypatch.setattr("app.db.set_setting", lambda conn, key, value: store.__setitem__(key, dict(value)))
    monkeypatch.setattr("app.db.save_fills", lambda conn, rows: None)
    monkeypatch.setattr("app.db.us_tickers", lambda conn: ["NVDA", "PLTR"])
    k = TickerKiwoom()
    FillsJob(k).run(FakeConn(), datetime(2026, 10, 20, 3, tzinfo=timezone.utc))
    assert store["fills_status"]["KR"]["ok"] and store["fills_status"]["US"]["ok"]
    assert {c[3] for c in k.calls if c[0] == "us"} == {None, "NVDA", "PLTR"}
