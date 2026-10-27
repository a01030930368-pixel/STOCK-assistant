from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app import live

NOW = datetime(2026, 10, 27, 2, 0, tzinfo=timezone.utc)  # 화요일 11:00 KST, 국내 장중 · 미국 장 밖


def test_kr_change_reads_signed_values():
    assert live.kr_change({"cur_prc": "+68400", "pred_pre": "+1200", "flu_rt": "+1.79"}) == (Decimal("68400"), Decimal("1200"), Decimal("1.79"))
    price, diff, pct = live.kr_change({"cur_prc": "-67000", "pred_pre": "", "flu_rt": "-0.50"})
    assert price == Decimal("67000") and diff is None and pct == Decimal("-0.50")


def test_from_pct():
    assert live.from_pct(Decimal("101"), Decimal("1")) == Decimal("1")
    assert live.from_pct(Decimal("10"), None) is None


def rows(**seen):
    return [(f"live:{t}", {"market": m, "seen": (NOW - timedelta(seconds=s)).isoformat()}) for t, (m, s) in seen.items()]


def test_due_only_recent_and_by_market_gap():
    r = rows(**{"005930": ("KR", 5), "IONQ": ("US", 5), "000660": ("KR", 120)})
    assert live.due(r, NOW, {}, 100.0) == [("005930", "KR"), ("IONQ", "US")]
    # 국내 장중은 2초, 미국 장 밖은 60초 간격
    assert live.due(r, NOW, {"005930": 97.0, "IONQ": 70.0}, 100.0) == [("005930", "KR")]
    assert live.due(r, NOW, {"005930": 99.0, "IONQ": 50.0}, 100.0) == []


class FakeConn:
    def __init__(self, rows):
        self.rows, self.updates = rows, []

    def execute(self, sql, params=None):
        if sql.startswith("UPDATE"):
            self.updates.append((params[1], params[0].obj))
        return self

    def fetchall(self):
        return self.rows


class FakeKiwoom:
    def kr_price(self, ticker):
        if ticker == "000660":
            raise RuntimeError("막혔어요")
        return Decimal("68400"), Decimal("1200"), Decimal("1.79")


def test_run_once_merges_quote_or_error():
    conn = FakeConn(rows(**{"005930": ("KR", 1), "000660": ("KR", 1)}))
    job = live.LiveQuotes(FakeKiwoom(), None)
    assert job.run_once(conn, NOW) == 2
    got = dict(conn.updates)
    assert got["live:005930"]["price"] == 68400 and got["live:005930"]["change"] == 1200 and got["live:005930"]["open"] is True
    assert "seen" not in got["live:005930"]
    assert got["live:000660"]["error"].startswith("막혔어요") and "price" not in got["live:000660"]
