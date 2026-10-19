"""텔레그램 일정 알림. 매일 저녁 8시(한국 시간)에 다음 날 일정(금리 결정·경제지표·만기·휴장·내 종목 실적)을 보냅니다."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
WEEK = "월화수목금토일"
EVENING = time(20, 0)
# 같은 날 여러 일정이 있으면 시장 전체에 영향이 큰 것부터 보여 줍니다.
ORDER = {"policy": 0, "economic": 1, "earnings": 2, "holiday": 3}


@dataclass(frozen=True)
class Item:
    kind: str
    title: str
    detail: str


def day_label(d: date) -> str:
    return f"{d.month}.{d.day:02d} ({WEEK[d.weekday()]})"


def evening_due(now: datetime) -> date | None:
    """저녁 8시가 지났으면 알릴 날짜(내일)를, 아니면 None을 돌려줍니다."""
    local = now.astimezone(KST)
    return local.date() + timedelta(days=1) if local.time() >= EVENING else None


def evening_message(day: date, items: list[Item]) -> str | None:
    if not items:
        return None
    lines = [f"[LODESTAR] 내일 일정 · {day_label(day)}"]
    for it in sorted(items, key=lambda i: (ORDER.get(i.kind, 9), i.title)):
        lines.append(f"· {it.title}" + (f"\n  {it.detail}" if it.detail else ""))
    return "\n".join(lines)
