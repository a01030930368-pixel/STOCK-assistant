from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.alerts import Alert, due, message
from app.market import kr_market_open

STOP = Alert(1, "005930", "삼성전자", "stop", "below", Decimal(65000))
TARGET = Alert(2, "005930", "삼성전자", "target", "above", Decimal(90000))
OTHER = Alert(3, "000660", "SK하이닉스", "target", "above", Decimal(1))


def test_due_respects_direction_and_missing_prices():
    assert due([STOP, TARGET, OTHER], {"005930": Decimal(65000)}) == [(STOP, Decimal(65000))]
    assert due([STOP, TARGET], {"005930": Decimal(70000)}) == []
    assert due([STOP, TARGET], {"005930": Decimal(91000)}) == [(TARGET, Decimal(91000))]


def test_message_wording():
    assert message(TARGET, Decimal(91000)) == "삼성전자(005930) 종목이 익절 목표가인 90,000에 도달했습니다. 현재가 91,000"
    assert "손절 목표가인 65,000" in message(STOP, Decimal(64000))


def test_market_hours_kst():
    kst = ZoneInfo("Asia/Seoul")
    assert kr_market_open(datetime(2026, 10, 19, 10, 0, tzinfo=kst))  # 월요일
    assert not kr_market_open(datetime(2026, 10, 19, 16, 0, tzinfo=kst))
    assert not kr_market_open(datetime(2026, 10, 18, 10, 0, tzinfo=kst))  # 일요일
