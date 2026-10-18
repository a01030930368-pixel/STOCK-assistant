from datetime import datetime, time
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
# 정규장 09:00~15:30 앞뒤로 10분 여유를 둡니다. 휴장일 처리는 2단계 캘린더에서 추가합니다.
OPEN = time(8, 50)
CLOSE = time(15, 40)


def kr_market_open(now: datetime) -> bool:
    local = now.astimezone(KST)
    return local.weekday() < 5 and OPEN <= local.time() <= CLOSE
