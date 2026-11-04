"""아침 브리핑의 '오늘 볼 연결고리'.

밤사이 해외 대표 종목(또는 공부 노트에 적은 해외 비교 기업)이 하루 ±5% 넘게 움직였으면,
지난 3년 같은 일이 있었던 다음 날 내 국내 종목(보유·관심·공부)이 어떻게 움직였는지 세어 알려 줘요.
과거 통계일 뿐 예측은 아니에요. 따라 움직인 비율이 낮은 짝은 빼고, 해당하는 게 없으면 아무것도 안 보여요.
"""
import html
import logging
from bisect import bisect_right
from dataclasses import dataclass
from datetime import date, timedelta

import httpx
import psycopg

from . import prices

log = logging.getLogger("worker")

# 국내 종목과 자주 같이 움직이는 미국 대표 종목(업종별). 공부 노트의 해외 비교 기업도 더해요.
ANCHORS = {
    "NVDA": "엔비디아", "MU": "마이크론", "AMD": "AMD", "AVGO": "브로드컴", "TSM": "TSMC", "ASML": "ASML",
    "AMAT": "어플라이드머티어리얼즈", "LRCX": "램리서치", "INTC": "인텔", "QCOM": "퀄컴", "SOXX": "반도체 ETF",
    "TSLA": "테슬라", "ALB": "앨버말", "AAPL": "애플", "MSFT": "마이크로소프트", "GOOGL": "알파벳", "META": "메타",
    "AMZN": "아마존", "LLY": "일라이 릴리", "NVO": "노보 노디스크", "MRNA": "모더나", "BA": "보잉", "LMT": "록히드마틴",
    "GE": "GE에어로스페이스", "XOM": "엑슨모빌", "COIN": "코인베이스", "PLTR": "팔란티어", "VST": "비스트라",
}
MOVE = 5.0  # 이만큼(%) 넘게 움직인 날만 봐요
YEARS = 3
MIN_EVENTS = 4  # 3년에 이만큼은 있어야 통계로 봐요
MIN_FOLLOW = 0.65  # 같은 방향으로 움직인 비율
MIN_AVG = 1.0  # 평균 움직임(%)
SHOW = 5
FULL_ROWS = 500  # 일봉이 이보다 적으면 5년 치를 한 번 받아요


@dataclass(frozen=True)
class Link:
    anchor: str
    anchor_name: str
    move: float  # 밤사이 등락(%)
    ticker: str
    name: str
    events: int  # 지난 3년 같은 방향으로 크게 움직인 날
    follow: int  # 그중 내 종목이 다음 거래일에 같은 방향으로 움직인 날
    avg: float  # 그 다음 거래일 내 종목 평균 등락(%)


def follow_stats(anchor: list[tuple[date, float]], mine: list[tuple[date, float]], move: float,
                 since: date, threshold: float = MOVE) -> tuple[int, int, float] | None:
    """anchor가 move와 같은 방향으로 threshold% 넘게 움직인 날마다, 그날 이후 내 종목 첫 거래일 등락을 봐요.
    내 종목 등락 = (그 다음 거래일 종가 / 해외 장 날짜까지의 마지막 종가 - 1). 마지막 날(오늘 일)은 빼요."""
    if len(anchor) < 2 or len(mine) < 2:
        return None
    days = [d for d, _ in mine]
    sign = 1 if move > 0 else -1
    rets: list[float] = []
    for i in range(1, len(anchor) - 1):
        d, c = anchor[i]
        p = anchor[i - 1][1]
        if d < since or not p:
            continue
        r = (c / p - 1) * 100
        if r * sign < threshold:
            continue
        j = bisect_right(days, d)  # 해외 장 날짜보다 뒤인 내 첫 거래일
        if j == 0 or j >= len(mine) or (mine[j][0] - d).days > 5:
            continue
        base = mine[j - 1][1]
        if base:
            rets.append((mine[j][1] / base - 1) * 100)
    if not rets:
        return None
    follow = sum(1 for r in rets if r * sign > 0)
    return len(rets), follow, sum(rets) / len(rets)


def pick(links: list[Link]) -> list[Link]:
    ok = [x for x in links if x.events >= MIN_EVENTS and x.follow / x.events >= MIN_FOLLOW and abs(x.avg) >= MIN_AVG]
    ok.sort(key=lambda x: -(x.follow / x.events) * abs(x.avg))
    seen, out = set(), []
    for x in ok:  # 내 종목 하나엔 가장 강한 짝 하나만
        if x.ticker in seen:
            continue
        seen.add(x.ticker)
        out.append(x)
    return out[:SHOW]


def lines(links: list[Link]) -> list[str]:
    """텔레그램 HTML 줄. 없으면 빈 목록(섹션째 안 보여요)."""
    if not links:
        return []
    e = html.escape
    out = ["", "🔗 <b>오늘 볼 연결고리</b>"]
    for x in links:
        dot = "🔴" if x.move > 0 else "🔵"
        word = "올랐" if x.move > 0 else "내렸"
        big = "넘게 오른" if x.move > 0 else "넘게 빠진"
        out.append(f"{dot} <b>{e(x.anchor_name)} {x.move:+.1f}%</b> → {e(x.name)}")
        out.append(f"<i>지난 {YEARS}년 {MOVE:.0f}% {big} {x.events}번 중 {x.follow}번 다음 날 같이 {word}어요 · 평균 {x.avg:+.1f}%</i>")
    out.append("<i>과거에 같이 움직였다는 통계예요. 예측이 아니에요.</i>")
    return out


# ---------------------------------------------------------------- DB·가져오기

def my_tickers(conn: psycopg.Connection) -> list[tuple[str, str]]:
    """국내 보유(ISA 포함)·관심·공부 종목. (ticker, name)"""
    return conn.execute(
        """SELECT ticker, MIN(name) FROM (
             SELECT ticker, name FROM holdings WHERE market = 'KR'
             UNION ALL SELECT ticker, name FROM isa_holdings
             UNION ALL SELECT ticker, name FROM watchlist WHERE market = 'KR'
             UNION ALL SELECT ticker, name FROM study_notes WHERE market = 'KR' AND status <> '탈락') t
           GROUP BY ticker ORDER BY ticker"""
    ).fetchall()


def anchors(conn: psycopg.Connection) -> dict[str, str]:
    """대표 종목 + 내 국내 종목의 해외 비교 기업(공부 노트)."""
    out = dict(ANCHORS)
    for t, n in conn.execute(
        """SELECT DISTINCT p.peer_ticker, p.peer_name FROM stock_peers p
           WHERE p.peer_market = 'US' AND p.ticker ~ '^[0-9][0-9A-Z]{5}$'"""
    ).fetchall():
        out.setdefault(t.upper(), n or t)
    return out


def closes(conn: psycopg.Connection, ticker: str, since: date) -> list[tuple[date, float]]:
    return [(d, float(c)) for d, c in conn.execute(
        "SELECT day, close FROM price_history WHERE ticker = %s AND day >= %s ORDER BY day", (ticker, since))]


def refresh(conn: psycopg.Connection, http: httpx.Client, ticker: str) -> None:
    """대표 종목 일봉: 처음엔 5년, 그 뒤로는 최근 5일만 받아 어젯밤 종가를 맞춰요."""
    from . import db

    have = conn.execute("SELECT count(*) FROM price_history WHERE ticker = %s", (ticker,)).fetchone()[0]
    rows = prices.us_daily(ticker, http) if have < FULL_ROWS else prices.yahoo_daily(ticker, http, span="5d")
    db.save_prices(conn, ticker, rows)


def build(conn: psycopg.Connection, http: httpx.Client, today: date, us_day: date | None) -> list[str]:
    """아침 브리핑에 넣을 줄. 미국장 날짜(us_day)를 모르면 아무것도 안 해요."""
    if us_day is None:
        return []
    mine = my_tickers(conn)
    if not mine:
        return []
    since = today - timedelta(days=365 * YEARS)
    found: list[Link] = []
    for ticker, name in anchors(conn).items():
        try:
            refresh(conn, http, ticker)
        except Exception as e:
            log.info("%s 일봉 받기 실패(연결고리): %s", ticker, e)
            continue
        hist = closes(conn, ticker, since - timedelta(days=10))
        if len(hist) < 2 or hist[-1][0] != us_day:
            continue
        move = (hist[-1][1] / hist[-2][1] - 1) * 100 if hist[-2][1] else 0.0
        if abs(move) < MOVE:
            continue
        for my, my_name in mine:
            stats = follow_stats(hist, closes(conn, my, since - timedelta(days=10)), move, since)
            if stats:
                found.append(Link(ticker, name, move, my, my_name, *stats))
    return lines(pick(found))

