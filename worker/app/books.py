"""종목 일기장 중 끝난 권(전량 매도)을 찾습니다. 웹의 web/src/lib/books.ts와 같은 방식이에요.

키움 체결을 날짜순으로 쌓아 보유 수량이 0이 되는 날을 찾고, 그날을 그 권의 키(시장:종목:전량 매도한 날)로 씁니다.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

EPS = Decimal("0.000001")


@dataclass(frozen=True)
class Trade:
    market: str
    ticker: str
    name: str
    day: date
    time: str | None
    side: str
    quantity: Decimal
    price: Decimal
    fee: Decimal | None


@dataclass(frozen=True)
class ClosedBook:
    key: str
    market: str
    ticker: str
    name: str
    start: date | None  # None이면 키움 기록보다 먼저 산 주식이 있어요
    end: date
    return_pct: float | None
    realized: float | None


@dataclass(frozen=True)
class Sold:
    market: str
    ticker: str
    name: str
    day: date
    pnl: float | None  # 평단 대비 손익에서 그날 수수료·세금을 뺀 값. 원가를 모르면 None


def _order(t: Trade):
    return (t.day, t.time or "", 0 if t.side == "buy" else 1)


def closed_books(trades: list[Trade], held: dict[tuple[str, str], Decimal]) -> list[ClosedBook]:
    return replay(trades, held)[0]


def replay(trades: list[Trade], held: dict[tuple[str, str], Decimal]) -> tuple[list[ClosedBook], list[Sold]]:
    """(끝난 권, 매도마다의 손익)."""
    sold: list[Sold] = []
    by_stock: dict[tuple[str, str], list[Trade]] = {}
    for t in trades:
        by_stock.setdefault((t.market, t.ticker), []).append(t)
    out = []
    for (market, ticker), items in by_stock.items():
        items.sort(key=_order)
        buys = sum((t.quantity for t in items if t.side == "buy"), Decimal(0))
        sells = sum((t.quantity for t in items if t.side == "sell"), Decimal(0))
        q = max(Decimal(0), held.get((market, ticker), Decimal(0)) - buys + sells)
        known = q <= EPS  # 기록 전부터 갖고 있던 주식이 있으면 원가를 몰라요
        start: date | None = None
        avg, cost, pnl, fees = Decimal(0), Decimal(0), Decimal(0), Decimal(0)
        active = q > EPS
        for t in items:
            if t.side == "buy":
                if not active:
                    active, known, start, q, avg, cost, pnl, fees = True, True, t.day, Decimal(0), Decimal(0), Decimal(0), Decimal(0), Decimal(0)
                avg = (q * avg + t.quantity * t.price) / (q + t.quantity)
                q += t.quantity
            else:
                if not active or t.quantity > q + EPS:
                    active, known, q = True, False, t.quantity
                one = t.quantity * (t.price - avg) if known else None
                if one is not None:
                    pnl += one
                    cost += t.quantity * avg
                sold.append(Sold(market, ticker, t.name, t.day, float(one - (t.fee or 0)) if one is not None else None))
                q -= t.quantity
            fees += t.fee or 0
            if q <= EPS:
                realized = float(pnl - fees) if known else None
                ret = round(realized / float(cost) * 100, 2) if realized is not None and cost > 0 else None
                out.append(ClosedBook(f"{market}:{ticker}:{t.day.isoformat()}", market, ticker, t.name,
                                      start if known else None, t.day, ret, realized))
                active, q, start = False, Decimal(0), None
    return out, sold
