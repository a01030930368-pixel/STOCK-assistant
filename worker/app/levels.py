"""차트에 그린 지지·저항에 가격이 닿았는지 봅니다. 선은 위아래로 지나가면, 구간은 안으로 들어오면 닿은 거예요."""
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from .alerts import format_price

KIND = {"support": "지지", "resistance": "저항"}
COOLDOWN = timedelta(hours=12)  # 선 근처에서 오르내려도 반나절에 한 번만 알려요


@dataclass(frozen=True)
class Level:
    id: int
    ticker: str
    name: str
    kind: str
    low: Decimal
    high: Decimal | None
    memo: str
    alert: bool
    last_price: Decimal | None
    alerted_at: datetime | None


def inside(level: Level, price: Decimal) -> bool:
    return level.high is not None and level.low <= price <= level.high


def touched(level: Level, current: Decimal) -> bool:
    """지난번 가격에서 지금 가격으로 오는 사이에 선을 지나갔거나 구간 안으로 들어왔나요?"""
    last = level.last_price
    if last is None:
        return False
    if level.high is None:
        return last != current and (last - level.low) * (current - level.low) <= 0
    if not inside(level, current):
        return False
    # 구간을 한 번에 건너뛴 게 아니라, 밖에 있다가 안으로 들어온 경우
    return not inside(level, last)


def due(levels: list[Level], prices: dict[str, Decimal], now: datetime) -> list[tuple[Level, Decimal, bool]]:
    """가격이 있는 선마다 (선, 현재가, 알림 보낼지)를 돌려줍니다. 알림을 안 보내도 지난번 가격은 새로 적어야 해요."""
    out = []
    for lv in levels:
        if lv.ticker not in prices:
            continue
        cur = prices[lv.ticker]
        if cur <= 0 or lv.last_price == cur:
            continue
        fresh = lv.alerted_at is None or now - lv.alerted_at >= COOLDOWN
        out.append((lv, cur, lv.alert and fresh and touched(lv, cur)))
    return out


def message(level: Level, current: Decimal) -> str:
    where = format_price(level.low) if level.high is None else f"{format_price(level.low)}~{format_price(level.high)} 구간"
    name = f"{level.name}({level.ticker})" if level.name else level.ticker
    lines = [f"📏 {KIND[level.kind]}선 닿음 · {name}", "", f"차트에 그린 {KIND[level.kind]} {where}에 가격이 닿았어요.",
             f"💲 현재가 {format_price(current)}"]
    if level.memo:
        lines += ["", f"📝 {level.memo}"]
    return "\n".join(lines)
