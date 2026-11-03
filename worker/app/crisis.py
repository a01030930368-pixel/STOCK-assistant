"""위기 리허설(포트폴리오 › 🧯)의 '그때 그대로' 계산에 쓸 과거 일봉.

지금 들고 있는 종목(일반·ISA·미국)과 코스피·나스닥·S&P500·원달러 환율을
과거 위기 구간(2020년 3월, 2022년, 2024년 8월)만 야후에서 받아 crisis_prices에 넣어요.
차트용 price_history와 섞지 않아요(출처·수정주가 기준이 달라서).
구간마다 한 번 받으면 끝이고, 그때 없던 종목(상장 전)은 30일 뒤에 한 번 더 확인해요.
계산은 웹(web/src/lib/crisis.ts)에서 해요.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone

import httpx
import psycopg

from . import intraday
from .markets import yahoo_closes

log = logging.getLogger("worker")

# (구간 이름, 시작, 화면에 보일 끝, 회복을 볼 끝). 웹 lib/crisis.ts WINDOWS와 같아야 해요.
WINDOWS = [
    ("covid", date(2020, 2, 17), date(2020, 5, 15), date(2020, 12, 30)),
    ("rate2022", date(2022, 1, 3), date(2022, 10, 14), date(2023, 6, 30)),
    ("aug2024", date(2024, 7, 31), date(2024, 8, 30), date(2024, 12, 30)),
]
LEAD = timedelta(days=10)  # 시작 전날 종가가 필요해서 조금 앞부터
INDEXES = {"KOSPI": "^KS11", "NASDAQ": "^IXIC", "SPX": "^GSPC", "USDKRW": "KRW=X"}
EVERY = timedelta(hours=6)
EMPTY_AGAIN = timedelta(days=30)
PER_RUN = 12  # 한 번에 받는 (종목, 구간) 수


def symbols(code: str, market: str) -> list[str]:
    """우리 코드 → 야후 이름 후보. 국내는 코스피(.KS) 다음 코스닥(.KQ)."""
    if code in INDEXES:
        return [INDEXES[code]]
    if market == "KR":
        return [f"{code}.KS", f"{code}.KQ"]
    return [code.upper().replace(".", "-")]


def period(start: date, end: date) -> dict:
    p1 = datetime.combine(start - LEAD, time(), timezone.utc)
    p2 = datetime.combine(end + timedelta(days=1), time(), timezone.utc)
    return {"period1": int(p1.timestamp()), "period2": int(p2.timestamp()), "interval": "1d"}


def fetch(http: httpx.Client, code: str, market: str, start: date, end: date) -> list:
    """(날짜, 종가) 목록. 그때 없던 종목이면 빈 목록."""
    last: Exception | None = None
    for sym in symbols(code, market):
        try:
            res = http.get(f"{intraday.YAHOO}{sym}", params=period(start, end), headers={"User-Agent": intraday.UA})
            if res.status_code == 404:
                continue
            res.raise_for_status()
            rows = [(d, c) for d, c in yahoo_closes(res.json()) if start - LEAD <= d <= end and c]
            if rows:
                return rows
        except Exception as e:  # 다음 후보로
            last = e
    if last and market != "KR":
        raise last
    return []


def targets(conn: psycopg.Connection) -> list[tuple[str, str]]:
    """지수 + 지금 보유 종목. (code, market)"""
    rows = conn.execute(
        """SELECT ticker, market FROM holdings WHERE quantity > 0
           UNION SELECT ticker, 'KR' FROM isa_holdings WHERE quantity > 0 ORDER BY 1"""
    ).fetchall()
    return [(c, "IDX") for c in INDEXES] + [(t, m) for t, m in rows]


def pending(conn: psycopg.Connection, now: datetime) -> list[tuple[str, str, tuple]]:
    done = {(c, w): (n, at) for c, w, n, at in conn.execute("SELECT code, win, rows, fetched_at FROM crisis_fetch").fetchall()}
    out = []
    for code, market in targets(conn):
        for win in WINDOWS:
            seen = done.get((code, win[0]))
            if seen and (seen[0] > 0 or now - seen[1] < EMPTY_AGAIN):
                continue
            out.append((code, market, win))
    return out


def save(conn: psycopg.Connection, code: str, win: str, rows: list) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO crisis_prices (code, day, close) VALUES (%s, %s, %s)
               ON CONFLICT (code, day) DO UPDATE SET close = EXCLUDED.close""",
            [(code, d, c) for d, c in rows],
        )
    conn.execute(
        """INSERT INTO crisis_fetch (code, win, rows, fetched_at) VALUES (%s, %s, %s, now())
           ON CONFLICT (code, win) DO UPDATE SET rows = EXCLUDED.rows, fetched_at = now()""",
        (code, win, len(rows)),
    )


class CrisisJob:
    def __init__(self, http: httpx.Client):
        self.http = http
        self.last: datetime | None = None
        self.failed: dict[tuple[str, str], datetime] = {}

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if self.last and now - self.last < EVERY:
            return
        self.last = now
        todo = [p for p in pending(conn, now) if now - self.failed.get((p[0], p[2][0]), now - EVERY * 4) >= EVERY * 4]
        for code, market, (win, start, _shown, end) in todo[:PER_RUN]:
            try:
                rows = fetch(self.http, code, market, start, end)
            except Exception as e:
                log.info("%s %s 위기 구간 일봉 받기 실패: %s", code, win, e)
                self.failed[(code, win)] = now
                continue
            save(conn, code, win, rows)
