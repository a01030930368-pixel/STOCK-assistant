from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app import shapes

DAYS = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]
NOW = datetime(2026, 10, 8, 1, tzinfo=timezone.utc)


def shape(kind="trend", points=None, last=None, alert=True, alerted=None):
    return shapes.Shape(1, "000660", "SK하이닉스", kind, points or [["2026-10-01", 0, 100], ["2026-10-05", 0, 120]], alert, last, alerted)


def test_line_extends_by_trading_days():
    idx = {d: i for i, d in enumerate(DAYS)}
    assert shapes.lines_at(shape(), idx, 4) == [140]
    ch = shape("channel", [["2026-10-01", 0, 100], ["2026-10-05", 0, 120], ["2026-10-02", 0, 90]])
    assert shapes.lines_at(ch, idx, 4) == [140, 140 - 20]
    assert shapes.lines_at(shape(points=[["2026-09-01", 0, 1], ["2026-10-05", 0, 2]]), idx, 4) == []
    assert shapes.now_index(DAYS, "2026-10-08") == 5 and shapes.now_index(DAYS, "2026-10-07") == 4


def test_alert_when_price_crosses_line():
    # 오늘(10-08)은 5번째 봉 자리라 선은 150
    got = shapes.due([shape(last=Decimal(145))], {"000660": Decimal(151)}, lambda t: DAYS, "2026-10-08", NOW)
    assert [(g[2], g[3]) for g in got] == [(150, True)]
    quiet = shapes.due([shape(last=Decimal(140))], {"000660": Decimal(145)}, lambda t: DAYS, "2026-10-08", NOW)
    assert quiet[0][3] is False
    cooled = shapes.due([shape(last=Decimal(145), alerted=NOW - timedelta(hours=1))], {"000660": Decimal(151)}, lambda t: DAYS, "2026-10-08", NOW)
    assert cooled[0][3] is False
    assert "추세선 닿음 · SK하이닉스(000660)" in shapes.message(shape(), Decimal(151), 150.0)
