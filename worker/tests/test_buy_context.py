from datetime import date, datetime, timezone
from decimal import Decimal

from app.buy_context_job import BuyContextJob
from app.macro import Indicator


class Cfg:
    ecos_api_key = "E"
    fred_api_key = "F"


def setup(monkeypatch, rows, bars=50):
    saved, fetched = {}, []
    monkeypatch.setattr("app.db.buys_without_context", lambda conn: rows)
    monkeypatch.setattr("app.db.save_buy_context", lambda conn, i, c: saved.__setitem__(i, c))
    monkeypatch.setattr("app.db.price_rows_before", lambda conn, t, d: bars)
    monkeypatch.setattr("app.db.save_prices", lambda conn, t, r: fetched.append(t))
    return saved, fetched


def test_saves_macro_as_of_buy_day(monkeypatch):
    saved, _ = setup(monkeypatch, [(7, date(2025, 3, 4), "SPYM", "US")])
    seen = []
    monkeypatch.setattr("app.macro.fetch_ecos", lambda k, d, h: seen.append(d) or [Indicator("usdkrw", Decimal("1450.5"), "20250304")])
    monkeypatch.setattr("app.macro.fetch_fred", lambda k, h, d: seen.append(d) or [Indicator("us_base_rate", Decimal("4.5"), "2025-03-04")])
    BuyContextJob(Cfg(), None).run(object(), datetime(2026, 10, 20, tzinfo=timezone.utc))
    assert seen == [date(2025, 3, 4)] * 2
    assert saved[7]["macro"] == {"usdkrw": {"value": "1450.5", "as_of": "20250304"}, "us_base_rate": {"value": "4.5", "as_of": "2025-03-04"}}


def test_retries_when_every_source_fails(monkeypatch):
    saved, _ = setup(monkeypatch, [(7, date(2025, 3, 4), "SPYM", "US")])

    def boom(*a):
        raise RuntimeError("down")
    monkeypatch.setattr("app.macro.fetch_ecos", boom)
    monkeypatch.setattr("app.macro.fetch_fred", boom)
    BuyContextJob(Cfg(), None).run(object(), datetime(2026, 10, 20, tzinfo=timezone.utc))
    assert saved == {}


def test_fetches_old_kr_bars_up_to_buy_day(monkeypatch):
    saved, fetched = setup(monkeypatch, [(3, date(2024, 1, 5), "005930", "KR")], bars=0)
    monkeypatch.setattr("app.macro.fetch_ecos", lambda k, d, h: [])
    monkeypatch.setattr("app.macro.fetch_fred", lambda k, h, d: [])

    class K:
        def kr_daily(self, ticker, base):
            assert base == "20240105"
            return []
    BuyContextJob(Cfg(), None, K()).run(object(), datetime(2026, 10, 20, tzinfo=timezone.utc))
    assert fetched == ["005930"] and saved[3]["macro"] == {}
