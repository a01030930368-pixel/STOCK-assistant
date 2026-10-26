"""텔레그램 알림 두 가지.

- 저녁 일정 알림: 매일 저녁 8시(한국 시간)에 다음 날 일정(금리 결정·경제지표·만기·휴장·내 종목 실적)을 보냅니다.
- 아침 브리핑: 평일과 토요일 아침 8시에 밤사이 미국장(토요일엔 금요일 미국장), 내 미국 종목(원화 손익·뉴스·AI 한마디), 국내 종목, 오늘 일정을 한 번에 보냅니다.
- 실적 전날 알림: 저녁 8시에, 내일 실적을 발표하는 보유 종목마다 따로 한 통씩 보냅니다.
- 주간 성적표: 일요일 저녁 8시에 이번 주 내 돈 변화, 보유 종목 등락, 매매, 강평 안 쓴 일기장, 다음 주 일정을 보냅니다.
"""
import html
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from . import calendar

KST = ZoneInfo("Asia/Seoul")
WEEK = "월화수목금토일"
EVENING = time(20, 0)
MORNING, MORNING_UNTIL = time(8, 0), time(11, 0)  # 워커가 늦게 켜져도 오전 11시까지는 보냅니다.
# 밤사이 미국장으로 보여 줄 지수(야후 기호, 이름)
INDEXES = [("^GSPC", "S&P 500"), ("^IXIC", "나스닥"), ("^SOX", "반도체(SOX)"), ("KRW=X", "원/달러")]
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
    """월~토 아침 8시~11시면 오늘 날짜를, 아니면 None을 돌려줍니다.
    금요일 미국장은 토요일 새벽에 끝나서 토요일 아침에도 보내요. 금요일이 미국 휴장이면 토요일엔 안 보내요."""
    local = now.astimezone(KST)
    if local.weekday() == 6 or not (MORNING <= local.time() < MORNING_UNTIL):
        return None
    if local.weekday() == 5 and calendar.is_holiday("US", local.date() - timedelta(days=1)):
        return None
    return local.date()


def _pct(v: float | None) -> str:
    return "-" if v is None else f"{v:+.1f}%"


def dot(v: float | None) -> str:
    """오르면 빨강, 내리면 파랑(한국식)."""
    return "⚪" if not v else "🔴" if v > 0 else "🔵"


def _price(market: str, v: float) -> str:
    return f"{v:,.0f}원" if market == "KR" else f"${v:,.2f}"


@dataclass(frozen=True)
class UsStock:
    """아침 브리핑의 미국 종목 카드 한 장. 값은 달러, 손익은 원화로 바꿔 보여 줘요."""
    ticker: str
    name: str
    quantity: float
    last: float
    prev: float | None  # 그 전 거래일 종가
    avg: float  # 평단
    news: str | None = None  # 밤사이 그 종목 뉴스 제목(한국어) 하나
    ai: str | None = None  # AI 한마디(참고용)

    @property
    def change_pct(self) -> float | None:
        return (self.last / self.prev - 1) * 100 if self.prev else None


@dataclass(frozen=True)
class UsTotal:
    won: float  # 밤사이 원화 손익(주가 + 환율)
    pct: float
    value: float  # 지금 평가액(원)
    fx_effect: float  # 그중 환율 때문에 생긴 몫(원)


def us_total(stocks: list[UsStock], fx: float | None, fx_prev: float | None) -> UsTotal | None:
    """원화 손익 = 주가 효과(전날 환율로) + 환율 효과(지금 값에). 환율을 모르면 None."""
    if not fx or not stocks:
        return None
    fx_prev = fx_prev or fx
    priced = [s for s in stocks if s.prev]
    price_part = sum(s.quantity * (s.last - s.prev) * fx_prev for s in priced)
    fx_part = sum(s.quantity * s.last * (fx - fx_prev) for s in priced)
    value = sum(s.quantity * s.last * fx for s in stocks)
    before = sum(s.quantity * s.prev * fx_prev for s in priced)
    won = price_part + fx_part
    return UsTotal(won, won / before * 100 if before else 0.0, value, fx_part)


def stock_won(s: UsStock, fx: float | None, fx_prev: float | None) -> float | None:
    if not fx or not s.prev:
        return None
    return s.quantity * (s.last * fx - s.prev * (fx_prev or fx))


def width(text: str) -> int:
    """고정폭 글씨에서 한글·이모지는 두 칸이에요."""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" or ord(ch) > 0x1F000 else 1 for ch in text)


def pad(text: str, n: int) -> str:
    return text + " " * max(1, n - width(text))


def _signed_won(v: float) -> str:
    return ("+" if v > 0 else "") + _won_short(v)


LINE = "━━━━━━━━━━━━━━"
AI_NOTE = "<i>🤖 AI 한마디는 참고용이에요. 사고팔지는 직접 판단해 주세요.</i>"


def morning_message(day: date, indexes: list[Quote], holdings: list[Holding], items: list[Item],
                    us: list[UsStock] | None = None, fx: float | None = None, fx_prev: float | None = None,
                    term: str | None = None, repeat: date | None = None) -> str:
    """텔레그램 HTML 모양(굵게·고정폭 표)으로 만들어요. 이름·뉴스 같은 글은 모두 이스케이프해요.
    term은 terms.message가 만든(이미 이스케이프한) 오늘의 용어예요.
    repeat은 지난 브리핑에서 이미 보낸 미국장 날짜예요(월요일 아침의 금요일 장 등). 있으면 '밤사이'라고 하지 않아요."""
    e = html.escape
    night = "금요일 밤" if day.weekday() == 5 else "밤사이"
    again = ""
    if repeat:
        night = f"{WEEK[repeat.weekday()]}요일"
        again = " <i>(토요일에 보낸 것과 같아요)</i>" if day.weekday() == 0 and repeat.weekday() == 4 else " <i>(지난번에 보낸 것과 같아요)</i>"
    lines = [f"☀️ <b>좋은 아침이에요</b> · {day_label(day)}"]
    if indexes:
        rows, col = [], max(width(q.name) for q in indexes) + 1
        for q in indexes:
            tail = f"  {q.last:,.0f}원" if q.name == "원/달러" else ""
            rows.append(f"{e(pad(q.name, col))}{dot(q.change_pct)} {_pct(q.change_pct):>6}{tail}")
        lines += ["", f"🌙 <b>{night} 미국장</b>{again}", "<pre>" + "\n".join(rows) + "</pre>"]
    us = us or []
    if us:
        total = us_total(us, fx, fx_prev)
        if total:
            lines += ["", f"💵 <b>{night} 내 미국 주식</b>{again}", f"<b>{dot(total.won)} {_signed_won(total.won)}</b>  ({_pct(total.pct)})"]
            sub = f"평가액 {_won_short(total.value)}"
            if abs(total.fx_effect) >= 10_000:
                sub += f" · 환율 효과 {_signed_won(total.fx_effect)}"
            lines.append(f"<i>{sub}</i>")
        lines += ["", "🇺🇸 <b>내 미국 종목</b>"]
        for s in sorted(us, key=lambda x: -abs(x.change_pct or 0)):
            facts = [f"${s.last:,.2f}"]
            if s.avg > 0:
                facts.append(f"평단 {_pct((s.last / s.avg - 1) * 100)}")
            if (w := stock_won(s, fx, fx_prev)) is not None:
                facts.append(_signed_won(w))
            lines += [LINE, f"{dot(s.change_pct)} <b>{e(s.name)}</b>   <b>{_pct(s.change_pct)}</b>", f"<i>{' · '.join(facts)}</i>"]
            if s.news:
                lines.append(f"📰 {e(s.news)}")
            if s.ai:
                lines.append(f"🤖 {e(s.ai)}")
        lines.append(LINE)
    # 미국 카드가 없으면(가격을 못 받았을 때) 미국 종목도 아래 표에 같이 넣어요.
    rest = [h for h in holdings if h.market == "KR" or not us]
    if rest:
        title = "💼 <b>국내 종목</b>" if us else "💼 <b>내 종목</b>"
        if day.weekday() == 5 and not calendar.is_holiday("KR", day - timedelta(days=1)):
            title += " <i>(금요일 마감)</i>"
        col = max(width(h.name) for h in rest) + 1
        rows = [f"{e(pad(h.name, col))}{dot(h.day_change_pct)} {_pct(h.day_change_pct):>6}  평단 {_pct(h.pnl_pct)}" for h in rest]
        lines += ["", title, "<pre>" + "\n".join(rows) + "</pre>"]
    lines += ["", "🗓️ <b>오늘 일정</b>"]
    lines += [e(x) for x in _items(items)] if items else ["큰 일정은 없어요 😌"]
    if term:
        lines += ["", LINE, term]
    if any(s.ai for s in us):
        lines += ["", AI_NOTE]
    return "\n".join(lines)


# AI 한마디: 종목마다 한 줄씩 받아요. 투자 권유가 아니라 "오늘 볼 점"이에요.
US_AI_SYSTEM = (
    "너는 개인 투자자의 아침 브리핑을 돕는 조수야. 미국 종목마다 밤사이 움직임과 뉴스를 보고 '오늘 볼 점'이나 앞으로의 가능성을 "
    "한국어 한 문장(45자 안팎)으로 써. 사라·팔아라 같은 권유, 목표가, 확정적인 예측은 쓰지 마. '~할 수 있어요', '~가능성이 있어요'처럼 말해. "
    "출력은 종목마다 한 줄씩 '티커|문장' 모양으로만 써."
)


def us_ai_prompt(stocks: list[UsStock], indexes: list[Quote], news: dict[str, list[str]]) -> str:
    idx = ", ".join(f"{q.name} {_pct(q.change_pct)}" for q in indexes) or "모름"
    out = [f"밤사이 지수: {idx}", ""]
    for s in stocks:
        heads = "; ".join(news.get(s.ticker, [])[:3]) or "뉴스 없음"
        avg = _pct((s.last / s.avg - 1) * 100) if s.avg > 0 else "-"
        out.append(f"{s.ticker} ({s.name}): 밤사이 {_pct(s.change_pct)}, 평단 대비 {avg}. 뉴스: {heads}")
    return "\n".join(out)


def parse_us_ai(text: str, tickers: list[str]) -> dict[str, str]:
    out = {}
    for line in text.splitlines():
        if "|" not in line:
            continue
        t, _, msg = line.partition("|")
        t = t.strip().strip("*- ").upper()
        msg = msg.strip().strip('"')
        if t in tickers and msg:
            out[t] = msg[:90]
    return out


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


def week_moves(rows, trades, start: date, end: date) -> list[tuple]:
    """보유 종목의 이번 주 등락: (이름, %, 이번 주에 처음 산 날 또는 None).
    이번 주에 새로 산 종목은 지난주 종가가 아니라 이번 주에 산 값(체결 평균)에서부터 셈해요.
    이번 주에 다 팔았다가 다시 샀으면 마지막으로 0주가 된 뒤에 산 것만 평균내요.
    rows는 db.weekly_inputs의 보유 종목 줄, trades는 키움 체결(books.Trade)이에요. ISA 체결은 없어서 ISA는 주간 등락 그대로예요."""
    out = []
    for name, market, ticker, isa, quantity, cur, prev in rows:
        if not cur:
            continue
        week = sorted((t for t in trades if not isa and t.market == market and t.ticker == ticker and start <= t.day <= end),
                      key=lambda t: (t.day, t.time or ""))
        # 지금 수량에서 거꾸로 거슬러 올라가며 마지막으로 0주였던 때를 찾아요.
        pos, cut = float(quantity), None
        for i in range(len(week) - 1, -1, -1):
            t = week[i]
            pos += float(t.quantity) if t.side == "sell" else -float(t.quantity)
            if pos <= 1e-9:
                cut = i
                break
        paid = [t for t in week[cut:] if t.side == "buy"] if cut is not None else []  # cut번째 체결 직전이 0주
        if paid:
            bought = sum(float(t.quantity) for t in paid)
            base = sum(float(t.quantity) * float(t.price) for t in paid) / bought
            out.append((name, (float(cur) / base - 1) * 100, min(t.day for t in paid)))
        elif prev:
            out.append((name, (float(cur) / float(prev) - 1) * 100, None))
    return out


@dataclass(frozen=True)
class Week:
    start: date
    total: float | None
    last_total: float | None
    moves: list  # (이름, 주간 %[, 이번 주에 산 날])
    buys: int
    sells: int
    realized: dict  # 시장 -> 판 것 손익 합(원가 모르는 매도는 빠짐)
    closed: list  # (이름, 수익률 %)
    unreviewed: int
    events: list  # (날짜, 종류, 제목)


def _move(m) -> str:
    text = f"{m[0]} {m[1]:+.1f}%"
    if len(m) > 2 and m[2]:
        text += f" ({WEEK[m[2].weekday()]}요일에 산 뒤)"
    return text


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
        lines += [f"🔴 {_move(m)}" for m in ups]
        lines += [f"🔵 {_move(m)}" for m in downs]
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
