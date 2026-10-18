from dataclasses import dataclass
from decimal import Decimal

KIND_LABEL = {"stop": "손절", "target": "익절", "custom": "알림"}


@dataclass(frozen=True)
class Alert:
    id: int
    ticker: str
    name: str
    kind: str
    direction: str
    price: Decimal


def is_triggered(alert: Alert, current: Decimal) -> bool:
    if alert.direction == "below":
        return current <= alert.price
    return current >= alert.price


def format_price(value: Decimal) -> str:
    if value == value.to_integral_value():
        return f"{int(value):,}"
    return f"{value:,.2f}"


def message(alert: Alert, current: Decimal) -> str:
    label = KIND_LABEL[alert.kind]
    return (
        f"{alert.name}({alert.ticker}) 종목이 {label} 목표가인 {format_price(alert.price)}에 도달했습니다. "
        f"현재가 {format_price(current)}"
    )


def due(alerts: list[Alert], prices: dict[str, Decimal]) -> list[tuple[Alert, Decimal]]:
    """현재가가 있는 종목 중 조건을 만족한 알림을 돌려줍니다."""
    return [(a, prices[a.ticker]) for a in alerts if a.ticker in prices and is_triggered(a, prices[a.ticker])]
