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
    if alert.kind == "custom":
        way = "⬇️ 아래로 내려왔어요" if alert.direction == "below" else "⬆️ 위로 올라왔어요"
        return "\n".join([f"🔔 관심종목 알림 · {alert.name}({alert.ticker})", "",
                          f"정해 둔 {format_price(alert.price)} {way}", f"💲 현재가 {format_price(current)}"])
    if alert.kind == "stop":
        head, tail = f"🛑 손절가 도달 · {alert.name}({alert.ticker})", "원칙대로 정리할지 확인해 보세요."
    else:
        head, tail = f"🎯 익절가 도달 · {alert.name}({alert.ticker})", "축하해요! 계획대로 차익을 챙길지 확인해 보세요 🎉"
    return "\n".join([head, "", f"{KIND_LABEL[alert.kind]} 목표가 {format_price(alert.price)}에 닿았어요.",
                      f"💲 현재가 {format_price(current)}", "", tail])


def due(alerts: list[Alert], prices: dict[str, Decimal]) -> list[tuple[Alert, Decimal]]:
    """현재가가 있는 종목 중 조건을 만족한 알림을 돌려줍니다. 0 이하 가격은 아직 못 받은 값이라 건너뜁니다."""
    return [(a, prices[a.ticker]) for a in alerts
            if a.ticker in prices and prices[a.ticker] > 0 and is_triggered(a, prices[a.ticker])]
