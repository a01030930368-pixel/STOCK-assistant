from datetime import datetime, time
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
# 정규장 09:00~15:30 앞뒤로 10분 여유를 둡니다. 휴장일 처리는 2단계 캘린더에서 추가합니다.
OPEN = time(8, 50)
CLOSE = time(15, 40)


NY = ZoneInfo("America/New_York")
# 미국 정규장 09:30~16:00(뉴욕 시간). 서머타임은 시간대가 알아서 처리합니다.
US_OPEN = time(9, 20)
US_CLOSE = time(16, 10)


def kr_market_open(now: datetime) -> bool:
    local = now.astimezone(KST)
    return local.weekday() < 5 and OPEN <= local.time() <= CLOSE


def us_market_open(now: datetime) -> bool:
    local = now.astimezone(NY)
    return local.weekday() < 5 and US_OPEN <= local.time() <= US_CLOSE
