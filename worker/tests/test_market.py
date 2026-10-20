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


def test_csat_day_runs_until_1630():
    from app.market import kr_trading_now
    # 2026-11-19 수능: 10:00~16:30. 16:20 KST = 07:20 UTC
    assert kr_market_open(utc(2026, 11, 19, 7, 20))
    assert kr_trading_now(utc(2026, 11, 19, 7, 20))
    assert not kr_trading_now(utc(2026, 11, 19, 0, 30))  # 09:30 KST, 아직 개장 전
    assert not kr_market_open(utc(2026, 11, 20, 7, 20))  # 다음 날은 평소대로 15:40까지


def test_trading_now_excludes_pre_open_and_weekend():
    from app.market import kr_trading_now, us_trading_now
    assert not kr_trading_now(utc(2026, 10, 19, 23, 55))  # 08:55 KST 다음 날, 장 전
    assert kr_trading_now(utc(2026, 10, 20, 1, 0))
    assert not kr_trading_now(utc(2026, 10, 17, 1, 0))  # 토요일
    assert not us_trading_now(utc(2026, 7, 15, 13, 25))  # 뉴욕 09:25
    assert us_trading_now(utc(2026, 7, 15, 13, 35))
