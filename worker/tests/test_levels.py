from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

from app.levels import Level, due, message, touched

NOW = datetime(2026, 10, 20, 6, tzinfo=timezone.utc)


def lv(low, high=None, last=None, alert=True, alerted_at=None, kind="resistance"):
    return Level(1, "000660", "SK하이닉스", kind, D(low), None if high is None else D(high), "매물대", alert,
                 None if last is None else D(last), alerted_at)


def test_line_touched_when_price_crosses_either_way():
    assert touched(lv(206000, last=207000), D(205500))
    assert touched(lv(206000, last=205000), D(206000))
    assert not touched(lv(206000, last=207000), D(206500))
    assert not touched(lv(206000), D(206000))  # 처음 보는 가격은 비교할 게 없어요


def test_zone_touched_only_when_entering():
    assert touched(lv(218000, 222000, last=216000), D(219000))
    assert not touched(lv(218000, 222000, last=219000), D(220000))
    assert not touched(lv(218000, 222000, last=216000), D(223000))


def test_due_records_price_and_respects_cooldown():
    levels = [lv(206000, last=207000), lv(206000, last=207000, alerted_at=NOW - timedelta(hours=1)),
              lv(206000, last=207000, alert=False), lv(206000, last=205000)]
    out = due(levels, {"000660": D(205000)}, NOW)
    assert [send for _, _, send in out] == [True, False, False]  # 마지막은 가격이 그대로라 건너뛰어요
    assert due(levels, {}, NOW) == []


def test_message():
    assert message(lv(218000, 222000), D(219000)) == (
        "[LODESTAR] SK하이닉스(000660) 가격이 차트에 그린 저항 218,000~222,000 구간에 닿았어요 · 매물대. 현재가 219,000")
