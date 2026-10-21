"""실적 발표 한눈에: 실적이 나오면 숫자 표 + 최근 5분기 막대 + AI 해설로 정리합니다.

국내: DART '영업(잠정)실적(공정공시)' 본문 표에서 이번 분기·지난 분기·1년 전 같은 분기 값을 읽어요.
      막대의 지난 분기들은 종목 페이지 재무제표(stock_statements)의 분기 값을 써요.
미국: Finnhub 실적 달력(실제·예상 EPS와 매출). 분기는 회사 회계연도 기준이에요.
"""
import html
import re
from dataclasses import dataclass, field
from datetime import date

import httpx

FINNHUB = "https://finnhub.io/api/v1"
ITEMS = ("revenue", "operating_income", "net_income")
LABEL = {"revenue": "매출", "operating_income": "영업이익", "net_income": "순이익"}
PRELIMINARY = re.compile(r"영업\(잠정\)실적")


@dataclass
class Report:
    id: str  # KR:접수번호 또는 US:티커:2026Q3
    ticker: str
    name: str
    market: str
    period: str  # 2026Q3 (미국은 회계연도)
    reported_on: date
    url: str
    # 항목별 {"cur": 이번 분기, "prev": 지난 분기, "yoy": 1년 전 같은 분기}. 국내는 원, 미국은 달러.
    lines: dict[str, dict[str, float | None]] = field(default_factory=dict)
    eps: dict[str, float | None] | None = None  # {"actual", "estimate"}
    revenue_estimate: float | None = None
    history: list[dict] = field(default_factory=list)  # [{"period", "revenue", "operating_income"}] 오래된 것부터, 이번 분기 포함
    surprises: list[dict] = field(default_factory=list)  # [{"period", "eps_pct", "revenue_pct"}] 오래된 것부터

    def data(self) -> dict:
        return {"unit": "USD" if self.market == "US" else "KRW", "lines": self.lines, "eps": self.eps,
                "revenue_estimate": self.revenue_estimate, "history": self.history, "surprises": self.surprises,
                "preliminary": self.market == "KR"}


# ---------------------------------------------------------------- 국내 잠정실적 본문

ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
CELL = re.compile(r"<(t[dheu])\b[^>]*>(.*?)</\1>", re.S | re.I)
UNIT = re.compile(r"단위\s*[:：]?\s*(십억원|억원|백만원|천원|원)")
MULT = {"원": 1, "천원": 1e3, "백만원": 1e6, "억원": 1e8, "십억원": 1e9}
NAMES = {
    "revenue": ("매출액", "영업수익", "수익(매출액)", "매출"),
    "operating_income": ("영업이익", "영업이익(손실)"),
    "net_income": ("당기순이익", "당기순이익(손실)", "순이익"),
}
PERIOD = re.compile(r"(?:20)?(\d{2})\s*[.년]\s*([1-4])\s*(?:Q|분기)")


def _text(raw: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


def _key(text: str) -> str:
    return re.sub(r"\s", "", text)


def _num(text: str) -> float | None:
    t = _key(text).replace(",", "")
    neg = t.startswith(("△", "-", "(", "▲")) and t not in ("-", "")
    t = t.strip("△▲-()")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def kr_period(day: date) -> str:
    """잠정실적 공시일로 어느 분기 실적인지: 1~3월은 작년 4분기, 4~6월은 1분기 …"""
    q = (day.month - 1) // 3
    return f"{day.year - 1}Q4" if q == 0 else f"{day.year}Q{q}"


def parse_preliminary(raw: str, day: date) -> tuple[str, dict[str, dict[str, float | None]]] | None:
    """잠정실적 공시 본문(XML/HTML)에서 (분기, 항목별 값). 단위를 못 찾거나 매출·영업이익이 없으면 None."""
    unit = UNIT.search(_text(raw))
    if not unit:
        return None
    mult = MULT[unit.group(1)]
    rows = [[_text(c[1]) for c in CELL.findall(r)] for r in ROW.findall(raw)]
    # 머리글에서 열 순서를 찾아요: 당기실적 | 전기실적 | 전기대비 | 전년동기실적 | 전년동기대비
    cur_i, prev_i, yoy_i = 0, 1, 3
    period = None
    for cells in rows:
        keys = [_key(c) for c in cells]
        cur = next((i for i, k in enumerate(keys) if k.startswith("당기실적") or k.startswith("당기(")), None)
        prev = next((i for i, k in enumerate(keys) if k.startswith("전기실적")), None)
        yoy = next((i for i, k in enumerate(keys) if k.startswith("전년동기실적")), None)
        if cur is not None and prev is not None and yoy is not None:
            prev_i, yoy_i = prev - cur, yoy - cur
            if m := PERIOD.search(cells[cur]):
                period = f"20{m.group(1)}Q{m.group(2)}"
            break
    lines: dict[str, dict[str, float | None]] = {}
    item = None
    for cells in rows:
        keys = [_key(c) for c in cells]
        found = next((name for name, names in NAMES.items() for k in keys if k in names), None)
        if found:
            item = found
        elif keys and keys[0] and not keys[0].startswith(("당해", "누계")) and _num(keys[0]) is None:
            item = None  # 법인세비용차감전… 같은 다른 항목
        at = next((i for i, k in enumerate(keys) if k.startswith("당해")), None)
        if item and at is not None and item not in lines:
            vals = cells[at + 1:]
            get = lambda i: _num(vals[i]) * mult if 0 <= i < len(vals) and _num(vals[i]) is not None else None
            if get(0) is not None:
                lines[item] = {"cur": get(0), "prev": get(prev_i), "yoy": get(yoy_i)}
    if "revenue" not in lines or "operating_income" not in lines:
        return None
    return period or kr_period(day), lines


def kr_history(period: str, cur: dict[str, float], quarters: dict[str, dict[str, float]]) -> list[dict]:
    """재무제표 분기 값(이번 분기 전) 4개 + 이번 분기."""
    before = sorted(p for p in quarters if p < period)[-4:]
    out = [{"period": p, "revenue": quarters[p].get("revenue"), "operating_income": quarters[p].get("operating_income")} for p in before]
    return out + [{"period": period, **cur}]


# ---------------------------------------------------------------- 미국 Finnhub

def finnhub_entries(ticker: str, key: str, today: date, http: httpx.Client) -> list[dict]:
    """최근 1년 남짓의 실적 발표(실제 값이 나온 것만), 오래된 것부터."""
    from datetime import timedelta

    res = http.get(f"{FINNHUB}/calendar/earnings", params={
        "symbol": ticker, "from": (today - timedelta(days=420)).isoformat(), "to": today.isoformat(), "token": key,
    })
    res.raise_for_status()
    rows = [e for e in res.json().get("earningsCalendar") or []
            if e.get("date") and e.get("year") and e.get("quarter") and (e.get("epsActual") is not None or e.get("revenueActual") is not None)]
    seen, out = set(), []
    for e in sorted(rows, key=lambda e: e["date"]):
        p = f"{e['year']}Q{e['quarter']}"
        if p not in seen:
            seen.add(p)
            out.append({**e, "period": p})
    return out


def _surprise(actual, estimate) -> float | None:
    if actual is None or estimate in (None, 0):
        return None
    return (actual / estimate - 1) * 100 * (1 if estimate > 0 else -1)


def us_report(ticker: str, name: str, entries: list[dict]) -> Report | None:
    if not entries:
        return None
    last = entries[-1]
    by = {e["period"]: e for e in entries}
    prev = entries[-2] if len(entries) > 1 else None
    yoy = by.get(f"{last['year'] - 1}Q{last['quarter']}")
    lines = {}
    if last.get("revenueActual") is not None:
        lines["revenue"] = {"cur": last["revenueActual"], "prev": prev and prev.get("revenueActual"), "yoy": yoy and yoy.get("revenueActual")}
    return Report(
        id=f"US:{ticker}:{last['period']}", ticker=ticker, name=name, market="US", period=last["period"],
        reported_on=date.fromisoformat(last["date"]),
        url=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={ticker}&type=10-Q",
        lines=lines, eps={"actual": last.get("epsActual"), "estimate": last.get("epsEstimate")},
        revenue_estimate=last.get("revenueEstimate"),
        history=[{"period": e["period"], "revenue": e.get("revenueActual"), "operating_income": None} for e in entries[-5:]],
        surprises=[{"period": e["period"], "eps_pct": _surprise(e.get("epsActual"), e.get("epsEstimate")),
                    "revenue_pct": _surprise(e.get("revenueActual"), e.get("revenueEstimate"))} for e in entries[-5:]],
    )


# ---------------------------------------------------------------- 글

def money(v: float | None, market: str) -> str:
    if v is None:
        return "-"
    sign = "−" if v < 0 else ""
    a = abs(v)
    if market == "US":
        if a >= 1e9:
            return f"{sign}${a / 1e9:.1f}B"
        return f"{sign}${a / 1e6:,.0f}M" if a >= 1e6 else f"{sign}${a:,.2f}"
    if a >= 1e12:
        return f"{sign}{a / 1e12:.1f}조"
    return f"{sign}{a / 1e8:,.0f}억" if a >= 1e8 else f"{sign}{a / 1e4:,.0f}만"


def change(cur: float | None, base: float | None) -> str:
    """'🔴+19%' / '🔵−5%' / '흑자 전환' 같은 비교 글. 비교할 수 없으면 빈 글."""
    if cur is None or base is None:
        return ""
    if base > 0 and cur > 0:
        pct = (cur / base - 1) * 100
        return f"{'🔴+' if pct >= 0 else '🔵−'}{abs(pct):.0f}%"
    if base <= 0 < cur:
        return "🔴흑자 전환"
    if base > 0 >= cur:
        return "🔵적자 전환"
    return "적자 지속"


def beat(actual: float | None, estimate: float | None) -> str:
    """예상 대비 '🔴+9%' / '🔵−3%'. 손실 예상이면 손실이 작을수록 +예요."""
    pct = _surprise(actual, estimate)
    if pct is None:
        return ""
    return f"{'🔴+' if pct >= 0 else '🔵−'}{abs(pct):.0f}%"


def usd(v: float) -> str:
    return f"{'−' if v < 0 else ''}${abs(v):.2f}"


def margin(lines: dict, key: str) -> float | None:
    op, rev = lines.get("operating_income", {}).get(key), lines.get("revenue", {}).get(key)
    return op / rev * 100 if op is not None and rev else None


BAR_MAX = 10


def bars(history: list[dict], item: str, market: str) -> list[str]:
    """텔레그램용 막대: 새 분기는 🟨, 지난 분기는 ⬜. 줄 맨 앞에서 시작해서 길이를 견줄 수 있어요."""
    rows = [h for h in history if h.get(item) is not None]
    if len(rows) < 2:
        return []
    top = max(abs(h[item]) for h in rows) or 1
    out = []
    for i, h in enumerate(rows):
        n = max(1, round(abs(h[item]) / top * BAR_MAX))
        out.append(("🟨" if i == len(rows) - 1 else "⬜") * n + f" {money(h[item], market)} · {quarter_label(h['period'])}")
    return out


def quarter_label(p: str) -> str:
    return f"{p[2:4]}.{p[5:]}Q"


def title_period(r: Report) -> str:
    y, q = r.period[:4], r.period[5:]
    return f"{q}분기 실적 (잠정)" if r.market == "KR" else f"{q}분기 실적 (회계연도 {y[2:]}년)"


def message(r: Report, ai: str = "", held: bool = True) -> str:
    # 들고 있지 않은 관심종목은 제목 끝에 표시해요.
    lines = [f"📊 {r.name} {title_period(r)}" + ("" if held else " · ⭐ 관심종목"), ""]
    for item in ITEMS:
        v = r.lines.get(item)
        if not v:
            continue
        lines.append(f"{LABEL[item]} {money(v['cur'], r.market)}")
        parts = []
        if item == "revenue" and r.revenue_estimate:
            parts.append(f"예상 {money(r.revenue_estimate, r.market)}보다 {beat(v['cur'], r.revenue_estimate)}")
        if c := change(v["cur"], v.get("yoy")):
            parts.append(f"1년 전보다 {c}")
        if c := change(v["cur"], v.get("prev")):
            parts.append(f"지난 분기보다 {c}")
        if parts:
            lines.append(" · ".join(parts))
        lines.append("")
    if r.eps and r.eps.get("actual") is not None:
        e = r.eps
        lines.append(f"EPS {usd(e['actual'])}" + (f" · 예상 {usd(e['estimate'])}보다 {beat(e['actual'], e['estimate'])}" if e.get("estimate") else ""))
        lines.append("")
    if (m := margin(r.lines, "cur")) is not None:
        before = margin(r.lines, "yoy")
        lines += [f"영업이익률 {m:.0f}%" + (f" (1년 전 {before:.0f}%)" if before is not None else ""), ""]
    hits = [s for s in r.surprises if s.get("eps_pct") is not None]
    if len(hits) >= 2:
        dots = "".join("🔴" if s["eps_pct"] >= 0 else "🔵" for s in hits)
        lines += [f"최근 {len(hits)}번 EPS {dots} · 예상보다 높음 {sum(s['eps_pct'] >= 0 for s in hits)}번", ""]
    for item in ("revenue", "operating_income"):
        if b := bars(r.history, item, r.market):
            lines += [f"📈 {LABEL[item]} 최근 분기", *b, ""]
    if ai:
        lines += [f"🤖 {ai}", ""]
    lines.append(f"🔗 {r.url}")
    return "\n".join(lines)


# ---------------------------------------------------------------- AI 해설

AI_SYSTEM = """너는 개인 투자자에게 회사 실적 발표를 풀어 주는 도우미다.
규칙:
- 아래 숫자와 뉴스에 있는 사실만 쓴다. 추측·전망·"사세요/파세요"는 쓰지 않는다.
- 뉴스에 실적이 왜 그렇게 나왔는지가 있으면 그 이유를 쓴다. 없으면 숫자가 보여 주는 것(무엇이 늘고 줄었는지, 이익률이 어떻게 변했는지)만 쓴다.
- 해요체 2~3문장, 200자 안팎. 앞뒤 따옴표나 머리말 없이 문장만 답한다."""


def ai_prompt(r: Report, news: list[tuple[str, str]]) -> str:
    out = [f"회사: {r.name} ({r.ticker})", f"분기: {r.period}" + (" (회계연도)" if r.market == "US" else " (잠정 실적)"), ""]
    for item in ITEMS:
        if v := r.lines.get(item):
            out.append(f"{LABEL[item]}: 이번 분기 {money(v['cur'], r.market)}, 지난 분기 {money(v.get('prev'), r.market)}, 1년 전 같은 분기 {money(v.get('yoy'), r.market)}")
    if r.revenue_estimate:
        out.append(f"매출 예상치: {money(r.revenue_estimate, r.market)}")
    if r.eps and r.eps.get("actual") is not None:
        out.append(f"EPS: 실제 {r.eps['actual']}, 예상 {r.eps.get('estimate')}")
    if news:
        out += ["", "최근 뉴스:"] + [f"- {t}" + (f": {s[:300]}" if s else "") for t, s in news[:8]]
    else:
        out += ["", "최근 뉴스: 없음"]
    return "\n".join(out)


def clean(text: str) -> str:
    body = " ".join(x.strip() for x in text.strip().splitlines() if x.strip())
    return body.strip("\"'“”‘’ ")[:400]
