"""오늘의 용어. 평일 아침 브리핑 맨 아래에 앱에 나오는 말을 하루 하나씩, 내 종목 숫자로 예를 들어 풀어 줍니다.

예시는 DB에 있는 숫자로 바로 계산해요(AI 아님). 예시를 만들 자료가 없으면 풀이만 보내요.
보낼 차례는 app_settings 'terms_next'에 남겨, 한 바퀴 돌면 처음부터 다시 시작해요."""
import html
from dataclasses import dataclass
from typing import Callable

import psycopg

from .screener import rsi


@dataclass(frozen=True)
class Term:
    name: str
    meaning: str
    example: Callable[[psycopg.Connection], str | None] | None = None


def _holdings(conn: psycopg.Connection) -> list[tuple[str, str, str, float, float, float]]:
    """(ticker, name, market, cur, avg, pnl_pct) 평가액 큰 순."""
    return [(t, n, m, float(c), float(a), float(p)) for t, n, m, c, a, p in conn.execute(
        "SELECT ticker, name, market, cur_price, avg_price, pnl_pct FROM holdings WHERE quantity > 0 ORDER BY eval_amount DESC"
    ).fetchall()]


def _closes(conn: psycopg.Connection, ticker: str, n: int = 250) -> list[float]:
    return [float(r[0]) for r in conn.execute(
        "SELECT close FROM (SELECT day, close FROM price_history WHERE ticker = %s ORDER BY day DESC LIMIT %s) t ORDER BY day", (ticker, n)
    ).fetchall()]


def _first(conn, fn):
    for h in _holdings(conn):
        out = fn(h)
        if out:
            return out
    return None


def _pct(v: float) -> str:
    return f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.1f}%"


def _money(v: float, market: str) -> str:
    if market == "US":
        return f"${v:,.2f}"
    return f"{v:,.0f}원"


def _big(v: float) -> str:
    a = abs(v)
    s = "−" if v < 0 else ""
    if a >= 1e12:
        return f"{s}{a / 1e12:.1f}조"
    return f"{s}{a / 1e8:,.0f}억"


def ex_avg(conn):
    def f(h):
        t, n, m, cur, avg, pnl = h
        return f"{n} 평단 {_money(avg, m)}, 지금 {_money(cur, m)} → 수익률 {_pct(pnl)}예요." if avg > 0 else None
    return _first(conn, f)


def ex_ma20(conn):
    def f(h):
        c = _closes(conn, h[0], 20)
        if len(c) < 20:
            return None
        ma = sum(c) / 20
        return f"{h[1]} 20일선 {_money(ma, h[2])}, 지금 {_money(c[-1], h[2])} → 20일선보다 {_pct((c[-1] / ma - 1) * 100)} {'위' if c[-1] >= ma else '아래'}예요."
    return _first(conn, f)


def ex_high52(conn):
    def f(h):
        c = _closes(conn, h[0])
        if len(c) < 60:
            return None
        return f"{h[1]} 52주 최고가 {_money(max(c), h[2])}, 지금은 그보다 {_pct((c[-1] / max(c) - 1) * 100)}예요."
    return _first(conn, f)


def ex_rsi(conn):
    def f(h):
        r = rsi(_closes(conn, h[0], 120))
        if r is None:
            return None
        where = "70을 넘어 단기로 많이 오른 편이에요" if r >= 70 else "30 아래라 많이 빠진 편이에요" if r <= 30 else "중간쯤이에요"
        return f"{h[1]} RSI {r:.0f} → {where}."
    return _first(conn, f)


def ex_bollinger(conn):
    def f(h):
        c = _closes(conn, h[0], 20)
        if len(c) < 20:
            return None
        m = sum(c) / 20
        sd = (sum((x - m) ** 2 for x in c) / 20) ** 0.5
        up, lo = m + 2 * sd, m - 2 * sd
        where = "위 선 근처" if c[-1] >= up - (up - m) * 0.2 else "아래 선 근처" if c[-1] <= lo + (m - lo) * 0.2 else "가운데쯤"
        return f"{h[1]} 위 선 {_money(up, h[2])}, 아래 선 {_money(lo, h[2])} → 지금은 {where}예요."
    return _first(conn, f)


def ex_foreign(conn):
    def f(h):
        if h[2] != "KR":
            return None
        row = conn.execute(
            "SELECT count(*), sum(foreign_net) FROM (SELECT foreign_net FROM investor_flows WHERE ticker = %s ORDER BY day DESC LIMIT 20) t", (h[0],)
        ).fetchone()
        if not row or not row[0] or row[0] < 5:
            return None
        v = float(row[1]) / 100
        return f"{h[1]} 최근 {row[0]}일 외국인 {v:+,.0f}억 → {'더 많이 샀어요' if v > 0 else '더 많이 팔았어요'}."
    return _first(conn, f)


def _fin(conn, ticker):
    return conn.execute(
        "SELECT revenue, operating_income, liabilities, equity FROM stock_financials WHERE ticker = %s ORDER BY period DESC LIMIT 1", (ticker,)
    ).fetchone()


def ex_margin(conn):
    def f(h):
        r = _fin(conn, h[0])
        if not r or not r[0] or r[1] is None:
            return None
        return f"{h[1]} 영업이익률 {float(r[1]) / float(r[0]) * 100:.0f}% → 100원어치 팔아 {float(r[1]) / float(r[0]) * 100:.0f}원을 본업으로 남겼어요."
    return _first(conn, f)


def ex_debt(conn):
    def f(h):
        r = _fin(conn, h[0])
        if not r or r[2] is None or not r[3] or float(r[3]) <= 0:
            return None
        d = float(r[2]) / float(r[3]) * 100
        return f"{h[1]} 부채비율 {d:.0f}% → {'자본보다 빚이 적어요' if d < 100 else '빚이 자본보다 많아요'}."
    return _first(conn, f)


def _per(conn, ticker, item):
    shares = conn.execute("SELECT shares FROM stock_shares WHERE ticker = %s", (ticker,)).fetchone()
    if not shares or not float(shares[0]):
        return None
    rows = conn.execute(
        "SELECT period, value FROM stock_statements WHERE ticker = %s AND kind = 'Q' AND item = %s ORDER BY period DESC LIMIT 4", (ticker, item)
    ).fetchall()
    if item == "net_income":
        if len(rows) < 4:
            return None
        base = sum(float(v) for _, v in rows)
    else:
        if not rows:
            return None
        base = float(rows[0][1])
    return base / float(shares[0]) if base > 0 else None


def ex_per(conn):
    def f(h):
        eps = _per(conn, h[0], "net_income")
        return f"{h[1]} PER {h[3] / eps:.1f}배 → 지금 주가는 1년 이익의 {h[3] / eps:.1f}배예요." if eps else None
    return _first(conn, f)


def ex_pbr(conn):
    def f(h):
        bps = _per(conn, h[0], "equity")
        return f"{h[1]} PBR {h[3] / bps:.1f}배 → 회사 순자산의 {h[3] / bps:.1f}배 값에 거래돼요." if bps else None
    return _first(conn, f)


def ex_fx(conn):
    rows = conn.execute("SELECT rate FROM fx_daily ORDER BY day DESC LIMIT 22").fetchall()
    us = conn.execute("SELECT sum(eval_amount) FROM holdings WHERE market = 'US' AND quantity > 0").fetchone()
    if len(rows) < 22 or not us or not us[0]:
        return None
    now, before = float(rows[0][0]), float(rows[-1][0])
    w = float(us[0]) * (now - before)
    return f"한 달 전 {before:,.0f}원 → 지금 {now:,.0f}원. 내 미국 주식 ${float(us[0]):,.0f}어치는 환율만으로 {'+' if w >= 0 else '−'}{abs(w) / 10000:,.0f}만원 달라졌어요."


def ex_earnings(conn):
    row = conn.execute(
        "SELECT name, period FROM earnings_reports WHERE market = 'KR' ORDER BY reported_on DESC LIMIT 1"
    ).fetchone()
    return f"{row[0]} {row[1][5:]}분기 잠정 실적이 가장 최근에 나왔어요. 종목 페이지 '최근 실적' 칸에서 볼 수 있어요." if row else None


def ex_d2(conn):
    row = conn.execute("SELECT deposit, d2_deposit FROM cash_balances WHERE market = 'KR'").fetchone()
    if not row or row[1] is None:
        return None
    return f"지금 국내 예수금 {float(row[0]):,.0f}원, D+2 예수금 {float(row[1]):,.0f}원이에요."


TERMS = [
    Term("평단(평균 단가)", "여러 번 나눠 산 값을 평균 낸 한 주 값이에요. 수익률은 평단과 지금 값을 비교해요.", ex_avg),
    Term("PER", "주가가 1년 이익(최근 4분기 순이익)의 몇 배인지예요. 낮을수록 이익에 비해 싸다는 뜻이에요.", ex_per),
    Term("PBR", "주가가 회사 순자산(자본)의 몇 배인지예요. 1배보다 낮으면 회사가 가진 것보다 싸게 거래되는 셈이에요.", ex_pbr),
    Term("20일선(이동평균선)", "최근 20거래일 종가의 평균이에요. 주가가 그 위면 한 달쯤 흐름이 좋은 편이에요.", ex_ma20),
    Term("RSI", "최근 14일 동안 오른 힘과 내린 힘을 비교한 0~100 숫자예요. 70 넘으면 단기 과열, 30 아래면 많이 빠진 편으로 봐요.", ex_rsi),
    Term("볼린저 밴드", "20일선 위아래로 주가가 평소 움직이는 폭을 그린 선이에요. 위 선에 닿으면 평소보다 많이 오른 편이에요.", ex_bollinger),
    Term("외국인 순매수", "외국인이 산 금액에서 판 금액을 뺀 값이에요. 며칠째 이어지는지도 같이 봐요.", ex_foreign),
    Term("영업이익률", "매출 중 본업으로 남긴 이익의 비율이에요. 높을수록 장사를 잘하는 회사예요.", ex_margin),
    Term("부채비율", "빚(부채)이 자본의 몇 %인지예요. 100% 아래면 자본보다 빚이 적어요.", ex_debt),
    Term("52주 최고가", "최근 1년 동안 가장 높았던 종가예요. 지금 값이 그보다 얼마나 아래인지로 위치를 봐요.", ex_high52),
    Term("환율 효과", "주가가 그대로여도 원/달러 환율이 바뀌면 미국 주식의 원화 값이 달라져요. 그 몫이에요.", ex_fx),
    Term("잠정 실적", "회계 감사 전에 회사가 먼저 알리는 실적이에요. 나중에 확정 숫자와 조금 다를 수 있어요.", ex_earnings),
    Term("D+2 예수금", "국내 주식은 판 돈이 이틀 뒤 들어와요. 오늘 사고판 걸 다 반영한 이틀 뒤 예수금이에요.", ex_d2),
    Term("유상증자", "회사가 새 주식을 팔아 돈을 모으는 거예요. 주식 수가 늘어 한 주 값이 흔들릴 수 있어요."),
    Term("자사주 소각", "회사가 자기 주식을 사서 없애는 거예요. 주식 수가 줄어 한 주의 몫이 커져요."),
    Term("전환사채(CB)", "나중에 주식으로 바꿀 수 있는 빚이에요. 바뀌면 주식 수가 늘어요."),
    Term("FOMC", "미국 기준금리를 정하는 회의예요. 1년에 8번 열리고, 금리가 바뀌면 전 세계 주식이 같이 움직여요."),
    Term("서머타임", "미국은 3월~11월에 시계를 1시간 당겨요. 그동안 미국 장이 한국 시간으로 1시간 일찍 열리고 닫혀요."),
]


def next_index(conn: psycopg.Connection, get_setting) -> int:
    return int(get_setting(conn, "terms_next") or 0) % len(TERMS)


def message(conn: psycopg.Connection, index: int) -> str:
    """브리핑 맨 아래에 붙일 HTML 글."""
    t = TERMS[index % len(TERMS)]
    lines = [f"📚 <b>오늘의 용어 · {html.escape(t.name, quote=False)}</b>", html.escape(t.meaning, quote=False)]
    try:
        ex = t.example(conn) if t.example else None
    except Exception:
        ex = None  # 예시 계산이 안 되면(표가 없는 예전 DB 등) 풀이만 보내요.
    if ex:
        lines += ["", "<i>내 종목으로 보면</i>", html.escape(ex, quote=False)]
    return "\n".join(lines)
