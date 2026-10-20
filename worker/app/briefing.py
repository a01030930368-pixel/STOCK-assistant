"""텔레그램 알림 두 가지.

- 저녁 일정 알림: 매일 저녁 8시(한국 시간)에 다음 날 일정(금리 결정·경제지표·만기·휴장·내 종목 실적)을 보냅니다.
- 아침 브리핑: 평일 아침 8시에 밤사이 미국장, 내 종목, 오늘 일정을 한 번에 보냅니다.
- 실적 전날 알림: 저녁 8시에, 내일 실적을 발표하는 보유 종목마다 따로 한 통씩 보냅니다.
- 주간 성적표: 일요일 저녁 8시에 이번 주 내 돈 변화, 보유 종목 등락, 매매, 강평 안 쓴 일기장, 다음 주 일정을 보냅니다.
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
# 텔레그램에서 한눈에 알아보게 일정 종류마다 이모지를 붙여요.
ICON = {"policy": "🏦", "economic": "📊", "earnings": "💼", "dividend": "💰", "holiday": "🏖️"}


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


def _items(items: list[Item]) -> list[str]:
    lines = []
    for it in sorted(items, key=lambda i: (ORDER.get(i.kind, 9), i.title)):
        lines.append(f"{ICON.get(it.kind, '📌')} {it.title}" + (f"\n      {it.detail}" if it.detail else ""))
    return lines


def evening_message(day: date, items: list[Item]) -> str | None:
    if not items:
        return None
    return "\n".join([f"🗓️ 내일 일정 · {day_label(day)}", "", *_items(items), "", "편안한 저녁 보내세요 🌙"])


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


def dot(v: float | None) -> str:
    """오르면 빨강, 내리면 파랑(한국식)."""
    return "⚪" if not v else "🔴" if v > 0 else "🔵"


def _price(market: str, v: float) -> str:
    return f"{v:,.0f}원" if market == "KR" else f"${v:,.2f}"


def morning_message(day: date, indexes: list[Quote], holdings: list[Holding], items: list[Item]) -> str:
    lines = [f"☀️ 좋은 아침이에요 · {day_label(day)}"]
    if indexes:
        lines += ["", "🌙 밤사이 미국장"]
        lines += [f"{dot(q.change_pct)} {q.name}  {q.last:,.2f} ({_pct(q.change_pct)})" for q in indexes]
    if holdings:
        lines += ["", "💼 내 종목", "      전일 대비 · 평단 대비"]
        lines += [f"{dot(h.day_change_pct)} {h.name}  {_price(h.market, h.price)}\n      {_pct(h.day_change_pct)} · {_pct(h.pnl_pct)}" for h in holdings]
    lines += ["", "🗓️ 오늘 일정"]
    lines += _items(items) if items else ["큰 일정은 없어요 😌"]
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
    lines = [f"📣 내일 실적 발표 · {e.name}", f"🗓️ {day_label(day)}" + (f" · {e.detail}" if e.detail else ""), ""]
    if e.last_surprise_pct is not None:
        good = e.last_surprise_pct >= 0
        lines.append(f"{'👍' if good else '👎'} 지난번 실적은 예상보다 {e.last_surprise_pct:+.0f}% {'좋았어요' if good else '나빴어요'}")
    now = f"{dot(e.pnl_pct)} 지금 평단 대비 {_pct(e.pnl_pct)}"
    if e.weight_pct is not None:
        now += f" · 내 돈의 {e.weight_pct:.0f}%"
    lines.append(now)
    plan = [f"🛑 손절 {_price(e.market, e.stop)}" if e.stop else "", f"🎯 익절 {_price(e.market, e.target)}" if e.target else ""]
    plan = [p for p in plan if p]
    lines.append(" · ".join(plan) if plan else "🔕 손절·익절 알림이 없어요")
    lines += ["", "실적 뒤에는 가격이 크게 움직일 수 있어요.", "들고 갈지, 줄일지 계획을 한 번 점검해 보세요 🧐"]
    return "\n".join(lines)


def review_message(book) -> str:
    """전량 매도한 다음 날 저녁, 사후강평을 쓰라고 알려 줍니다. book은 books.ClosedBook입니다."""
    days = f"{book.start.month}.{book.start.day:02d} → " if book.start else "기록 전 → "
    days += f"{book.end.month}.{book.end.day:02d}"
    if book.start:
        days += f" · {(book.end - book.start).days}일"
    result = f"수익률 {_pct(book.return_pct)}" if book.return_pct is not None else "수익률은 기록 전에 산 주식이 있어 못 구했어요"
    if book.realized is not None:
        sign = "+" if book.realized > 0 else "-" if book.realized < 0 else ""
        result += f" ({sign}{_price(book.market, abs(book.realized))})"
    return "\n".join([
        f"📕 다 팔았어요 · {book.name}",
        f"🗓️ {days}",
        f"{dot(book.return_pct)} {result}",
        "",
        "첫 매수부터 전량 매도까지, 일기장 한 권이 끝났어요.",
        "기억이 생생할 때 사후강평을 써 보세요 ✍️",
        "",
        "👉 LODESTAR → 매매일지 → 일기장",
    ])


def weekly_due(now: datetime) -> date | None:
    """일요일 저녁 8시가 지났으면 이번 주 월요일을, 아니면 None을 돌려줍니다."""
    local = now.astimezone(KST)
    if local.weekday() != 6 or local.time() < EVENING:
        return None
    return local.date() - timedelta(days=6)


def _won_short(v: float) -> str:
    """1억 2,345만원 / 3,210만원 / 8,500원처럼 읽기 쉽게."""
    n = round(abs(v))
    sign = "-" if v < 0 else ""
    if n >= 100_000_000:
        eok, man = divmod(n // 10_000, 10_000)
        return f"{sign}{eok}억" + (f" {man:,}만원" if man else "원")
    if n >= 10_000:
        return f"{sign}{n // 10_000:,}만원"
    return f"{sign}{n:,}원"


@dataclass(frozen=True)
class Week:
    start: date
    total: float | None
    last_total: float | None
    moves: list  # (이름, 주간 %)
    buys: int
    sells: int
    realized: dict  # 시장 -> 판 것 손익 합(원가 모르는 매도는 빠짐)
    closed: list  # (이름, 수익률 %)
    unreviewed: int
    events: list  # (날짜, 종류, 제목)


def weekly_message(w: Week) -> str:
    end = w.start + timedelta(days=6)
    lines = [f"📊 이번 주 성적표", f"🗓️ {day_label(w.start)} ~ {day_label(end)}", ""]
    if w.total is not None and w.last_total:
        diff = w.total - w.last_total
        lines.append(f"💰 내 돈 {_won_short(w.total)}")
        lines.append(f"{dot(diff)} 지난주보다 {diff / w.last_total * 100:+.1f}% ({'+' if diff >= 0 else ''}{_won_short(diff)})")
    elif w.total is not None:
        lines.append(f"💰 내 돈 {_won_short(w.total)}")
        lines.append("지난주 기록이 없어서 다음 주부터 비교해 드려요")
    if w.moves:
        ups = sorted((m for m in w.moves if m[1] > 0), key=lambda m: -m[1])[:3]
        downs = sorted((m for m in w.moves if m[1] < 0), key=lambda m: m[1])[:3]
        lines += ["", "💼 내 종목 이번 주"]
        lines += [f"🔴 {n} {p:+.1f}%" for n, p in ups]
        lines += [f"🔵 {n} {p:+.1f}%" for n, p in downs]
    lines.append("")
    if w.buys or w.sells:
        lines.append(f"🔁 이번 주 매매 · 매수 {w.buys}번 · 매도 {w.sells}번")
        for market, v in w.realized.items():
            money = _won_short(v) if market == "KR" else f"{'-' if v < 0 else ''}${abs(v):,.2f}"
            lines.append(f"{dot(v)} 판 것 손익({'국내' if market == 'KR' else '미국'}) {'+' if v > 0 else ''}{money}")
        for n, p in w.closed:
            lines.append(f"📕 다 판 종목 · {n} {_pct(p)}")
    else:
        lines.append("🔁 이번 주 매매 · 없었어요")
    if w.unreviewed:
        lines.append(f"✍️ 사후강평 안 쓴 일기장 {w.unreviewed}권\n      매매일지 → 일기장에서 써 보세요")
    lines.append("")
    if w.events:
        lines.append("🗓️ 다음 주 일정")
        shown = sorted(w.events, key=lambda e: (e[0], ORDER.get(e[1], 9), e[2]))
        lines += [f"{ICON.get(k, '📌')} {day_label(d)} {t}" for d, k, t in shown[:8]]
        if len(shown) > 8:
            lines.append(f"➕ 그 밖에 {len(shown) - 8}개는 일정 화면에서 보세요")
    else:
        lines.append("🗓️ 다음 주 일정 · 큰 일정은 없어요")
    lines += ["", "한 주 수고 많으셨어요 🙌"]
    return "\n".join(lines)
