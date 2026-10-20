"""텔레그램 알림 두 가지.

- 저녁 일정 알림: 매일 저녁 8시(한국 시간)에 다음 날 일정(금리 결정·경제지표·만기·휴장·내 종목 실적)을 보냅니다.
- 아침 브리핑: 평일 아침 8시에 밤사이 미국장, 내 종목, 오늘 일정을 한 번에 보냅니다.
- 실적 전날 알림: 저녁 8시에, 내일 실적을 발표하는 보유 종목마다 따로 한 통씩 보냅니다.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
WEEK = "월화수목금토일"
EVENING = time(20, 0)
MORNING, MORNING_UNTIL = time(8, 0), time(11, 0)  # 워커가 늦게 켜져도 오전 11시까지는 보냅니다.
# 밤사이 미국장으로 보여 줄 지수(야후 기호, 이름)
INDEXES = [("^GSPC", "S&P 500"), ("^IXIC", "나스닥"), ("^SOX", "필라델피아 반도체"), ("KRW=X", "원/달러")]
# 같은 날 여러 일정이 있으면 시장 전체에 영향이 큰 것부터 보여 줍니다.
ORDER = {"policy": 0, "economic": 1, "earnings": 2, "dividend": 3, "holiday": 4}


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


@dataclass(frozen=True)
class Quote:
    name: str
    last: float
    change_pct: float | None


@dataclass(frozen=True)
class Holding:
    name: str
    market: str
    price: float
    day_change_pct: float | None
    pnl_pct: float


def morning_due(now: datetime) -> date | None:
    """평일 아침 8시~11시면 오늘 날짜를, 아니면 None을 돌려줍니다."""
    local = now.astimezone(KST)
    if local.weekday() >= 5 or not (MORNING <= local.time() < MORNING_UNTIL):
        return None
    return local.date()


def _pct(v: float | None) -> str:
    return "-" if v is None else f"{v:+.1f}%"


def _price(market: str, v: float) -> str:
    return f"{v:,.0f}원" if market == "KR" else f"${v:,.2f}"


def morning_message(day: date, indexes: list[Quote], holdings: list[Holding], items: list[Item]) -> str:
    lines = [f"[LODESTAR] 아침 브리핑 · {day_label(day)}"]
    if indexes:
        lines += ["", "밤사이 미국장"]
        lines += [f"· {q.name} {q.last:,.2f} ({_pct(q.change_pct)})" for q in indexes]
    if holdings:
        lines += ["", "내 종목 (전일 대비 · 평단 대비)"]
        lines += [f"· {h.name} {_price(h.market, h.price)} · {_pct(h.day_change_pct)} · {_pct(h.pnl_pct)}" for h in holdings]
    lines += ["", "오늘 일정"]
    if items:
        for it in sorted(items, key=lambda i: (ORDER.get(i.kind, 9), i.title)):
            lines.append(f"· {it.title}" + (f"\n  {it.detail}" if it.detail else ""))
    else:
        lines.append("· 큰 일정은 없어요")
    return "\n".join(lines)


@dataclass(frozen=True)
class EarningsEve:
    name: str
    market: str
    detail: str  # 일정의 예상 EPS 등
    pnl_pct: float
    weight_pct: float | None
    stop: float | None
    target: float | None
    last_surprise_pct: float | None  # 지난번 실제 EPS가 예상보다 몇 % 높았나


def earnings_eve_message(day: date, e: EarningsEve) -> str:
    lines = [f"[LODESTAR] 내일 실적 발표 · {e.name}", day_label(day) + (f" · {e.detail}" if e.detail else "")]
    if e.last_surprise_pct is not None:
        lines.append(f"지난번 실적은 예상보다 {e.last_surprise_pct:+.0f}% {'좋았어요' if e.last_surprise_pct >= 0 else '나빴어요'}")
    now = f"지금 평단 대비 {_pct(e.pnl_pct)}"
    if e.weight_pct is not None:
        now += f" · 내 돈의 {e.weight_pct:.0f}%"
    lines.append(now)
    plan = [f"손절 {_price(e.market, e.stop)}" if e.stop else "", f"익절 {_price(e.market, e.target)}" if e.target else ""]
    plan = [p for p in plan if p]
    lines.append(" · ".join(plan) if plan else "손절·익절 알림이 없어요")
    lines.append("실적 뒤에는 가격이 크게 움직일 수 있어요. 들고 갈지, 줄일지 계획을 한 번 점검해 보세요.")
    return "\n".join(lines)
