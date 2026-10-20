from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from .calendar import is_holiday

KST = ZoneInfo("Asia/Seoul")
# 정규장 09:00~15:30 앞뒤로 10분 여유를 둡니다. 거래소 휴장일에는 조회하지 않습니다.
OPEN = time(8, 50)
CLOSE = time(15, 40)
KR_SESSION = (time(9, 0), time(15, 30))
# 시간이 바뀌는 날. 수능 날은 10:00~16:30, 새해 첫 거래일은 10:00 개장입니다.
# 다음 해 수능 날짜가 발표되면 여기에 더해 주세요.
KR_SPECIAL = {
    date(2026, 11, 19): (time(10, 0), time(16, 30)),
}


NY = ZoneInfo("America/New_York")
# 미국 정규장 09:30~16:00(뉴욕 시간). 서머타임은 시간대가 알아서 처리합니다.
US_OPEN = time(9, 20)
US_CLOSE = time(16, 10)
US_SESSION = (time(9, 30), time(16, 0))


def _kr_trading_day(day: date) -> bool:
    return day.weekday() < 5 and not is_holiday("KR", day)


def kr_session(day: date) -> tuple[time, time]:
    """그날 한국 정규장 시작·끝 시각."""
    if day in KR_SPECIAL:
        return KR_SPECIAL[day]
    first = date(day.year, 1, 2)
    while not _kr_trading_day(first):
        first = date.fromordinal(first.toordinal() + 1)
    if day == first:
        return time(10, 0), KR_SESSION[1]
    return KR_SESSION


def _shift(t: time, minutes: int) -> time:
    total = t.hour * 60 + t.minute + minutes
    return time(total // 60, total % 60)


def kr_market_open(now: datetime) -> bool:
    """장 시작 10분 전부터 끝나고 10분 뒤까지. 잔고·알림 확인에 씁니다."""
    local = now.astimezone(KST)
    if not _kr_trading_day(local.date()):
        return False
    start, end = kr_session(local.date())
    return min(OPEN, _shift(start, -10)) <= local.time() <= max(CLOSE, _shift(end, 10))


def kr_trading_now(now: datetime) -> bool:
    """정규장이 실제로 열려 있는 동안(마감 뒤 5분까지). 오늘 일봉을 적을 때 씁니다."""
    local = now.astimezone(KST)
    if not _kr_trading_day(local.date()):
        return False
    start, end = kr_session(local.date())
    return start <= local.time() <= _shift(end, 5)


def us_market_open(now: datetime) -> bool:
    local = now.astimezone(NY)
    return local.weekday() < 5 and US_OPEN <= local.time() <= US_CLOSE and not is_holiday("US", local.date())


def us_trading_now(now: datetime) -> bool:
    local = now.astimezone(NY)
    return (local.weekday() < 5 and US_SESSION[0] <= local.time() <= _shift(US_SESSION[1], 5)
            and not is_holiday("US", local.date()))
