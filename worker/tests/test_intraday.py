from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

import pytest

from app import intraday
from app.intraday_job import IntradayJob


def test_parse_kr_minutes_uses_kst_and_sorts():
    body = {"stk_min_pole_chart_qry": [
        {"cntr_tm": "20261020090100", "cur_prc": "+61300", "open_pric": "+61200", "high_pric": "+61400", "low_pric": "-61100", "trde_qty": "1500"},
        {"cntr_tm": "20261020090000", "cur_prc": "-61200", "trde_qty": "900"},
        {"cntr_tm": "", "cur_prc": "1"},
    ]}
    bars = intraday.parse_kr_minutes(body)
    assert [b.ts.astimezone(timezone.utc).hour for b in bars] == [0, 0]
    assert bars[1] == intraday.MinuteBar(bars[1].ts, D(61200), D(61400), D(61100), D(61300), D(1500))
    assert bars[0].open == bars[0].close == D(61200)


def test_parse_yahoo_skips_empty_minutes():
    body = {"chart": {"result": [{"timestamp": [1760967000, 1760967060], "indicators": {"quote": [
        {"open": [40.1, None], "high": [40.5, None], "low": [40.0, None], "close": [40.2, None], "volume": [1200, None]}]}}]}}
    bars = intraday.parse_yahoo(body)
    assert len(bars) == 1
    assert bars[0].ts == datetime.fromtimestamp(1760967000, timezone.utc)
    assert (bars[0].close, bars[0].volume) == (D("40.2"), D(1200))


def test_parse_yahoo_reports_error():
    with pytest.raises(ValueError, match="야후"):
        intraday.parse_yahoo({"chart": {"result": None, "error": {"description": "No data found"}}})


class FakeKiwoom:
    def __init__(self):
        self.calls = []

    def kr_minutes(self, ticker):
        self.calls.append(ticker)
        return []


def test_job_polls_open_market_every_two_minutes(monkeypatch):
    saved = []
    monkeypatch.setattr("app.intraday_job.db.watched_stocks", lambda conn: [("005930", "삼성전자", "KR"), ("IONQ", "아이온큐", "US")])
    monkeypatch.setattr("app.intraday_job.db.save_minutes", lambda conn, t, b: saved.append(t))
    monkeypatch.setattr("app.intraday_job.intraday.yahoo_minutes", lambda t, http: [])
    kw = FakeKiwoom()
    job = IntradayJob(None, kw)
    t = datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc)  # 10:00 KST, 미국은 닫힘
    job.run(None, t)
    assert saved == ["005930", "IONQ"]  # 처음에는 둘 다 한 번
    job.run(None, t + timedelta(minutes=1))
    assert saved == ["005930", "IONQ"]
    job.run(None, t + timedelta(minutes=2))
    assert saved == ["005930", "IONQ", "005930"]


def test_parse_yahoo_snaps_live_bar_to_the_minute():
    body = {"chart": {"result": [{"timestamp": [1760621400, 1760621460, 1760621487], "indicators": {"quote": [
        {"open": [1, 2, 3], "high": [1, 2, 3], "low": [1, 2, 3], "close": [1, 2, 3], "volume": [1, 1, 1]}]}}]}}
    bars = intraday.parse_yahoo(body)
    assert [b.ts.second for b in bars] == [0, 0] and bars[-1].close == 3
