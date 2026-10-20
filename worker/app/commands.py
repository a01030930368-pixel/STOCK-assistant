"""텔레그램 명령에 답하는 글. 조회만 합니다. 주문 명령은 없습니다.

글을 만드는 함수는 DB와 무관하게 값만 받아 테스트하기 쉽게 둡니다.
"""
from dataclasses import dataclass
from datetime import date

from .briefing import day_label

# 텔레그램 명령 메뉴에는 영어 소문자만 쓸 수 있어서, 한글 명령과 짝을 지어 둡니다.
ALIASES = {
    "잔고": "balance", "balance": "balance",
    "보유": "holdings", "종목": "holdings", "holdings": "holdings",
    "알림": "alerts", "alerts": "alerts",
    "일정": "calendar", "calendar": "calendar",
    "관심": "watch", "관심종목": "watch", "watch": "watch",
    "도움": "help", "help": "help", "start": "help",
}
MENU = [
    ("balance", "잔고: 총자산·손익·예수금"),
    ("holdings", "보유: 종목별 수익률"),
    ("alerts", "알림: 켜져 있는 가격 알림"),
    ("calendar", "일정: 앞으로 7일 일정"),
    ("watch", "관심: 관심종목 현재가"),
    ("help", "도움: 명령 목록"),
]


def parse(text: str) -> str | None:
    """'/잔고', '/balance@MyBot', '잔고' 모두 'balance'로. 모르는 말이면 None."""
    word = (text or "").strip().split(maxsplit=1)[0] if (text or "").strip() else ""
    word = word.lstrip("/").split("@", 1)[0].lower()
    return ALIASES.get(word)


def won(v: float) -> str:
    return f"{v:,.0f}원"


def money(market: str, v: float) -> str:
    return won(v) if market == "KR" else f"${v:,.2f}"


def pct(v: float | None) -> str:
    return "-" if v is None else f"{v:+.2f}%"


@dataclass(frozen=True)
class Account:
    market: str
    total_eval: float
    total_pnl: float
    total_pnl_pct: float
    cash: float | None


def balance_text(accounts: list[Account], usd_krw: float) -> str:
    if not accounts:
        return "아직 잔고를 불러오지 않았어요. 워커가 키움에 처음 연결되면 보여 드릴게요."
    lines = ["[잔고]"]
    total = 0.0
    for a in accounts:
        rate = 1.0 if a.market == "KR" else usd_krw
        total += (a.total_eval + (a.cash or 0)) * rate
        label = "국내" if a.market == "KR" else "해외"
        lines.append(f"· {label} 주식 {money(a.market, a.total_eval)} ({pct(a.total_pnl_pct)}, {money(a.market, a.total_pnl)})")
        if a.cash is not None:
            lines.append(f"  예수금 {money(a.market, a.cash)}")
    lines.insert(1, f"총자산 {won(total)}" + (" (달러는 원화로 환산)" if usd_krw and any(a.market == "US" for a in accounts) else ""))
    return "\n".join(lines)


def holdings_text(rows: list[tuple[str, str, float, float]]) -> str:
    """rows: (이름, 시장, 현재가, 평단 대비 %)"""
    if not rows:
        return "보유 종목이 없어요."
    lines = ["[보유 종목] 현재가 · 평단 대비"]
    lines += [f"· {name} {money(m, price)} · {pct(p)}" for name, m, price, p in rows]
    return "\n".join(lines)


KIND = {"stop": "손절", "target": "익절", "custom": "알림"}


def alerts_text(rows: list[tuple[str, str, str, str, float, float | None]]) -> str:
    """rows: (이름, 시장, 종류, 방향, 가격, 현재가)"""
    if not rows:
        return "켜져 있는 가격 알림이 없어요."
    lines = ["[가격 알림] 현재가에서 남은 거리"]
    for name, m, kind, direction, price, cur in rows:
        way = "아래로" if direction == "below" else "위로"
        gap = f" · {(price / cur - 1) * 100:+.1f}%" if cur else ""
        lines.append(f"· {name} {KIND.get(kind, '알림')} {money(m, price)} {way}{gap}")
    return "\n".join(lines)


def calendar_text(rows: list[tuple[date, str]]) -> str:
    """rows: (날짜, 제목)"""
    if not rows:
        return "앞으로 7일 동안 큰 일정이 없어요."
    lines = ["[앞으로 7일 일정]"]
    last = None
    for day, title in rows:
        if day != last:
            lines.append(day_label(day))
            last = day
        lines.append(f"· {title}")
    return "\n".join(lines)


def watch_text(rows: list[tuple[str, str, float | None, float | None, float | None]]) -> str:
    """rows: (이름, 시장, 현재가, 등락 %, 가장 가까운 목표가)"""
    if not rows:
        return "관심종목이 없어요. 앱의 관심종목 탭에서 넣을 수 있어요."
    lines = ["[관심종목] 현재가 · 목표가까지"]
    for name, m, cur, change, target in rows:
        price = money(m, cur) if cur else "현재가 확인 중"
        tail = f" · 목표 {money(m, target)} ({(target / cur - 1) * 100:+.1f}%)" if target and cur else ""
        lines.append(f"· {name} {price}" + (f" ({pct(change)})" if change is not None else "") + tail)
    return "\n".join(lines)


def help_text() -> str:
    return "\n".join(["[LODESTAR 명령]"] + [f"/{cmd} 또는 /{desc.split(':')[0]} · {desc.split(': ')[1]}" for cmd, desc in MENU]
                     + ["", "조회만 할 수 있어요. 주문은 하지 않아요."])
