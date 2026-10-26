"""차트에 그린 추세선·평행 채널에 가격이 닿았는지 봅니다. 일봉 차트에 그린 것만 봐요(봉 번호를 거래일로 셀 수 있어서).

점은 [날짜, 봉 안 위치(0~1), 가격]. 선 값은 두 점을 이은 직선을 거래일 번호로 늘려서 구해요.
채널은 세 번째 점이 평행선 높이예요."""
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from .alerts import format_price
from .levels import COOLDOWN

KIND = {"trend": "추세선", "channel": "평행 채널"}


@dataclass(frozen=True)
class Shape:
    id: int
    ticker: str
    name: str
    kind: str
    points: list
    alert: bool
    last_price: Decimal | None
    alerted_at: datetime | None


def _x(days: dict[str, int], point) -> float | None:
    i = days.get(str(point[0]))
    return None if i is None else i + float(point[1])


def lines_at(shape: Shape, days: dict[str, int], at: float) -> list[float]:
    """at번째 봉 자리에서 선(채널이면 두 선)의 가격. 점의 날짜가 일봉에 없으면 빈 목록.

    두 점을 어느 쪽부터 찍었든 같은 직선이에요. 화면도 늘 오른쪽(오늘 쪽)으로 늘려 그려요."""
    if len(shape.points) < 2:
        return []
    x1, x2 = _x(days, shape.points[0]), _x(days, shape.points[1])
    if x1 is None or x2 is None or x1 == x2:
        return []
    p1, p2 = float(shape.points[0][2]), float(shape.points[1][2])
    line = lambda x: p1 + (p2 - p1) * (x - x1) / (x2 - x1)
    out = [line(at)]
    if shape.kind == "channel" and len(shape.points) >= 3:
        x3 = _x(days, shape.points[2])
        if x3 is not None:
            out.append(line(at) + float(shape.points[2][2]) - line(x3))
    return out


NY, KST = ZoneInfo("America/New_York"), ZoneInfo("Asia/Seoul")


def today_of(ticker: str, now: datetime) -> str:
    """그 종목 일봉이 쌓이는 날짜(db.snapshot_prices와 같게): 미국은 뉴욕 날짜, 국내는 한국 날짜.

    티커 모양으로 시장을 정해요(web lib/journal.ts guessMarket과 같은 규칙). 영문만이면 미국, 그 밖은 국내."""
    us = re.fullmatch(r"[A-Z]+([.-][A-Z]+)?", ticker.strip().upper()) is not None
    return now.astimezone(NY if us else KST).date().isoformat()


def now_index(days: list[str], today: str) -> float:
    """오늘 봉 자리. 오늘 일봉이 아직 없으면 마지막 봉 바로 다음이에요."""
    return len(days) - 1 if days and days[-1] == today else len(days)


def due(shapes: list[Shape], prices: dict[str, Decimal], days_of, today, now: datetime) -> list[tuple[Shape, Decimal, float | None, bool]]:
    """(그림, 현재가, 닿은 선 가격, 알림 보낼지). days_of(ticker) -> 일봉 날짜 목록(오래된 순).

    today는 날짜 문자열이나 today(ticker) -> 그 종목 시장의 오늘 날짜."""
    out = []
    for s in shapes:
        cur = prices.get(s.ticker)
        if cur is None or cur <= 0 or s.last_price == cur:
            continue
        days = days_of(s.ticker)
        index = {d: i for i, d in enumerate(days)}
        lines = lines_at(s, index, now_index(days, today(s.ticker) if callable(today) else today))
        hit = None
        if s.last_price is not None:
            last, c = float(s.last_price), float(cur)
            hit = next((v for v in lines if (last - v) * (c - v) <= 0), None)
        fresh = s.alerted_at is None or now - s.alerted_at >= COOLDOWN
        out.append((s, cur, hit, s.alert and fresh and hit is not None))
    return out


def message(shape: Shape, current: Decimal, line: float) -> str:
    name = f"{shape.name}({shape.ticker})" if shape.name else shape.ticker
    return "\n".join([f"📐 {KIND.get(shape.kind, '선')} 닿음 · {name}", "", f"일봉 차트에 그린 {KIND.get(shape.kind, '선')}(지금 {format_price(Decimal(str(round(line, 2))))})에 가격이 닿았어요.",
                      f"💲 현재가 {format_price(current)}"])
