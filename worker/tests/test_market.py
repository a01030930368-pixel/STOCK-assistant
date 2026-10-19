from datetime import datetime, timezone

from app.market import kr_market_open, us_market_open


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def test_us_market_open_follows_daylight_saving():
    # 서머타임(7월): 뉴욕 09:30 = UTC 13:30
    assert us_market_open(utc(2026, 7, 15, 13, 30))
    assert not us_market_open(utc(2026, 7, 15, 21, 0))
    # 표준시(1월): 뉴욕 09:30 = UTC 14:30
    assert not us_market_open(utc(2026, 1, 14, 13, 30))
    assert us_market_open(utc(2026, 1, 14, 14, 30))


def test_us_market_closed_on_weekend():
    # 2026-10-17은 토요일
    assert not us_market_open(utc(2026, 10, 17, 15, 0))


def test_kr_market_open():
    # 한국 10:00 = UTC 01:00, 2026-10-19 월요일
    assert kr_market_open(utc(2026, 10, 19, 1, 0))
    assert not kr_market_open(utc(2026, 10, 19, 8, 0))


def test_markets_closed_on_exchange_holidays():
    # 2026-10-09 한글날(금), 2026-11-26 추수감사절(목)
    assert not kr_market_open(utc(2026, 10, 9, 1, 0))
    assert not us_market_open(utc(2026, 11, 26, 15, 0))
