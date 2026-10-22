from datetime import datetime, timezone
from decimal import Decimal

from app import main
from app.isa_job import IsaJob
from app.kiwoom import Balance, Cash, Holding


class FakeIsa:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def kr_fills(self, start, end):
        self.calls.append((start, end))
        if self.fail:
            raise RuntimeError("키움 API 오류 kt00015: 계좌 없음")
        return []

    def domestic_balance(self):
        h = Holding("360750", "TIGER 미국S&P500", Decimal(245), Decimal(20935), Decimal(22390), Decimal(5485550),
                    Decimal(356475), Decimal("6.95"))
        return Balance([h], Decimal(5129075), Decimal(5485550), Decimal(356475), Decimal("6.95"), Decimal(14200))

    def kr_cash(self):
        return Cash("KRW", Decimal(14200), Decimal(14200), Decimal(14200))


def fake_db(monkeypatch):
    store = {}
    monkeypatch.setattr("app.db.get_setting", lambda conn, key: store.get(key))
    monkeypatch.setattr("app.db.set_setting", lambda conn, key, value: store.__setitem__(key, value))
    monkeypatch.setattr("app.db.save_isa_fills", lambda conn, rows: None)
    return store


def test_isa_job_reads_whole_year_once_then_recent(monkeypatch):
    store = fake_db(monkeypatch)
    k = FakeIsa()
    job = IsaJob(k)
    job.run(object(), datetime(2026, 10, 20, 3, tzinfo=timezone.utc))
    assert k.calls[0][0] == "20260101" and store["isa_fills_year"] == 2026 and store["isa_status"]["ok"]
    k.calls.clear()
    job.run(object(), datetime(2026, 10, 20, 3, 40, tzinfo=timezone.utc))
    assert k.calls == [("20261010", "20261020")]


def test_isa_job_keeps_error_for_screen(monkeypatch):
    store = fake_db(monkeypatch)
    IsaJob(FakeIsa(fail=True)).run(object(), datetime(2026, 10, 20, 3, tzinfo=timezone.utc))
    assert not store["isa_status"]["ok"] and "계좌 없음" in store["isa_status"]["error"]
    assert "isa_fills_year" not in store


def test_isa_job_skips_without_key(monkeypatch):
    store = fake_db(monkeypatch)
    IsaJob(None).run(object())
    assert store == {}


def test_tick_saves_isa_balance_separately(monkeypatch):
    store = fake_db(monkeypatch)
    saved = {}
    monkeypatch.setattr("app.db.save_isa_balance", lambda conn, b: saved.__setitem__("balance", b))
    monkeypatch.setattr("app.db.save_isa_cash", lambda conn, c: saved.__setitem__("cash", c))
    for name in ("snapshot_prices", "save_level_seen", "mark_triggered"):
        monkeypatch.setattr(f"app.db.{name}", lambda *a: None)
    monkeypatch.setattr("app.db.current_prices", lambda conn: {})
    monkeypatch.setattr("app.db.active_alerts", lambda conn: [])
    monkeypatch.setattr("app.db.chart_levels", lambda conn: [])
    monkeypatch.setattr("app.db.chart_shapes", lambda conn: [])
    cfg = type("C", (), {"telegram_bot_token": "", "telegram_chat_id": ""})()
    main.tick(cfg, object(), None, True, False, datetime(2026, 10, 20, 3, tzinfo=timezone.utc), FakeIsa())
    assert saved["balance"].holdings[0].ticker == "360750" and saved["cash"].deposit == 14200
    assert store["isa_balance_status"]["ok"]
