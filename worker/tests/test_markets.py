from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

from app import markets


def yahoo(tz, stamps, closes):
    return {"chart": {"result": [{"meta": {"exchangeTimezoneName": tz}, "timestamp": stamps,
                                  "indicators": {"quote": [{"open": closes, "high": closes, "low": closes, "close": closes, "volume": [0] * len(closes)}]}}]}}


def test_yahoo_closes_use_exchange_date():
    # 코스피는 한국 시각 09:00(뉴욕으로는 전날 밤)에 봉이 시작해요. 한국 날짜로 적혀야 해요.
    t = int(datetime(2026, 10, 23, 0, 0, tzinfo=timezone.utc).timestamp())
    rows = markets.yahoo_closes(yahoo("Asia/Seoul", [t], [2612.4]))
    assert rows == [(date(2026, 10, 23), Decimal("2612.4"))]


def test_scale_yen_and_tnx():
    d = date(2026, 10, 23)
    assert markets.scale("JPYKRW", [(d, Decimal("8.891"))]) == [(d, Decimal("889.100"))]
    assert markets.scale("US10Y", [(d, Decimal("42.1"))])[0][1] == Decimal("4.21")
    assert markets.scale("US10Y", [(d, Decimal("4.21"))])[0][1] == Decimal("4.21")


def test_ecos_and_fred_rows():
    assert markets.ecos_closes([{"TIME": "20261023", "DATA_VALUE": "2.61"}, {"TIME": "202610", "DATA_VALUE": "1"}]) == [(date(2026, 10, 23), Decimal("2.61"))]
    assert markets.fred_closes([{"date": "2026-10-23", "value": "4.02"}, {"date": "2026-10-22", "value": "4.01"}])[0][0] == date(2026, 10, 22)


class FakeRes:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


class FakeHttp:
    def __init__(self, fail=()):
        self.asked, self.fail = [], set(fail)

    def get(self, url, params=None, headers=None):
        name = url.rsplit("/", 1)[-1]
        self.asked.append((name, (params or {}).get("range")))
        if name in self.fail:
            raise RuntimeError("막혔어요")
        if "fearandgreed" in url:
            return FakeRes({"fear_and_greed": {"score": 40, "timestamp": "2026-10-23T20:00:00+00:00"}})
        t = int(datetime(2026, 10, 23, 14, 30, tzinfo=timezone.utc).timestamp())
        return FakeRes(yahoo("America/New_York", [t], [100.0]))


def test_job_saves_skips_missing_keys_and_records_errors(monkeypatch):
    saved, settings = {}, {}
    monkeypatch.setattr(markets.db, "save_sector_daily", lambda conn, m, c, rows: saved.__setitem__(f"{m}:{c}", rows))
    monkeypatch.setattr(markets.db, "set_setting", lambda conn, k, v: settings.__setitem__(k, v))
    http = FakeHttp(fail={"^SOX", "^TNX"})
    job = markets.MarketsJob(SimpleNamespace(ecos_api_key="", fred_api_key=""), http)
    now = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)
    job.run(None, now)
    assert "MK:KOSPI" in saved and "MK:BTC" in saved and "MK:FEARGREED" in saved and "MK:KR3Y" not in saved and "MK:US2Y" not in saved
    st = settings["markets_status"]
    assert not st["ok"] and set(st["errors"]) == {"SOX", "US10Y"}
    assert ("^KS11", "2y") in http.asked
    # 30분 안에는 다시 안 받고, 그 뒤에는 짧게 받아요
    http.asked.clear()
    job.run(None, now.replace(minute=10))
    assert http.asked == []
    job.run(None, now.replace(minute=40))
    assert ("^KS11", "5d") in http.asked and ("^SOX", "2y") in http.asked


def test_cnn_fear_greed_rows():
    x = datetime(2026, 10, 23, 23, 59, tzinfo=timezone.utc).timestamp() * 1000  # 뉴욕 10-23 저녁
    body = {"fear_and_greed": {"score": 61.857, "rating": "greed", "timestamp": "2026-10-26T14:30:00+00:00"},
            "fear_and_greed_historical": {"data": [{"x": x, "y": 55.2, "rating": "neutral"}]}}
    assert markets.cnn_closes(body) == [(date(2026, 10, 23), Decimal("55.2")), (date(2026, 10, 26), Decimal("61.9"))]
