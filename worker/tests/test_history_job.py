from datetime import date, datetime, timezone
from decimal import Decimal

from app import history_job


def test_kospi_scale_undoes_hundredfold():
    rows = [(date(2026, 10, 20), Decimal("252127")), (date(2026, 10, 21), Decimal("253000"))]
    assert history_job.kospi_scale(rows)[1][1] == Decimal("2530")
    plain = [(date(2026, 10, 21), Decimal("2530.12"))]
    assert history_job.kospi_scale(plain) == plain


class FakeKiwoom:
    def __init__(self):
        self.asked = []

    def kr_daily(self, ticker, base):
        self.asked.append(ticker)
        return [("row",)]

    def sector_daily(self, code, base, price=None):
        return [(date(2026, 10, 21), Decimal("253000"))]


def test_request_fetches_and_clears(monkeypatch):
    settings = {"history_request": {"tickers": [["005930", "KR"], ["nvda", "US"]]}}
    saved = {}
    monkeypatch.setattr(history_job.db, "get_setting", lambda conn, k: settings.get(k))
    monkeypatch.setattr(history_job.db, "set_setting", lambda conn, k, v: settings.__setitem__(k, v))
    monkeypatch.setattr(history_job.db, "clear_setting_if",
                        lambda conn, k, seen: settings[k] == seen and settings.__setitem__(k, None))
    monkeypatch.setattr(history_job.db, "save_prices", lambda conn, t, rows: saved.__setitem__(t, rows))
    monkeypatch.setattr(history_job.db, "save_sector_daily", lambda conn, m, c, rows: saved.__setitem__(f"{m}:{c}", rows))
    monkeypatch.setattr(history_job.db, "traded_unwatched", lambda conn: [("000660", "KR")])
    monkeypatch.setattr(history_job.prices, "us_daily", lambda t, http: [("us",)])
    monkeypatch.setattr(history_job.prices, "yahoo_daily", lambda t, http, span: [])
    k = FakeKiwoom()
    job = history_job.HistoryJob(None, k)
    job.run(None, datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc))
    assert settings["history_request"] is None and settings["history_status"]["ok"]
    assert saved["NVDA"] == [("us",)] and "005930" in saved and "000660" in saved
    assert saved["IX:KOSPI"][0][1] == Decimal("2530")
    # 같은 날 같은 때에는 다시 받지 않아요
    k.asked.clear()
    job.run(None, datetime(2026, 10, 21, 8, 5, tzinfo=timezone.utc))
    assert k.asked == []
