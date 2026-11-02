"""실적 발표의 시장 예상치(컨센서스).

- 미국: Finnhub 실적 달력(최근 3년)과 /stock/earnings(최근 4분기)에서 EPS·매출의 예상과 실제를 받아요.
- 국내: 지난 예상치를 무료로 주는 곳이 없어서, 네이버 증권 분기 실적 표의 예상(E) 칸을 매일 적어 둬요.
  발표가 나면 그 분기 예상치는 더 바꾸지 않으니, 앞으로 나오는 실적부터 "예상 대비"를 볼 수 있어요.
"""
import logging
import re
from dataclasses import dataclass
from datetime import date, timedelta

import httpx
import psycopg

log = logging.getLogger("worker")

FINNHUB = "https://finnhub.io/api/v1"
NAVER_QUARTER = "https://m.stock.naver.com/api/stock/{}/finance/quarter"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
EOK = 100_000_000  # 네이버 표는 억원 단위
YEARS = 3


@dataclass
class Estimate:
    ticker: str
    period: str  # 2026Q3
    market: str
    source: str  # finnhub | naver
    eps_actual: float | None = None
    eps_estimate: float | None = None
    revenue_actual: float | None = None
    revenue_estimate: float | None = None
    op_estimate: float | None = None
    net_estimate: float | None = None
    reported_on: date | None = None
    hour: str | None = None  # bmo(개장 전) | amc(마감 뒤) | ''


def _f(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    if s in ("", "-", "N/A", "NaN"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ---------------------------------------------------------------- 미국

def finnhub_estimates(ticker: str, calendar: list[dict], earnings: list[dict]) -> list[Estimate]:
    """달력(매출·EPS 예상과 실제, 발표일·시간)에 /stock/earnings(EPS)를 겹쳐요. 실제 값이 나온 분기만."""
    out: dict[str, Estimate] = {}
    for e in sorted(calendar, key=lambda e: e.get("date") or ""):
        if not (e.get("year") and e.get("quarter") and e.get("date")):
            continue
        if e.get("epsActual") is None and e.get("revenueActual") is None:
            continue
        p = f"{e['year']}Q{e['quarter']}"
        out[p] = Estimate(ticker, p, "US", "finnhub", _f(e.get("epsActual")), _f(e.get("epsEstimate")),
                          _f(e.get("revenueActual")), _f(e.get("revenueEstimate")),
                          reported_on=date.fromisoformat(e["date"][:10]), hour=e.get("hour") or "")
    for e in earnings:
        if not (e.get("year") and e.get("quarter")) or e.get("actual") is None:
            continue
        p = f"{e['year']}Q{e['quarter']}"
        cur = out.setdefault(p, Estimate(ticker, p, "US", "finnhub"))
        if cur.eps_actual is None:
            cur.eps_actual = _f(e.get("actual"))
        if cur.eps_estimate is None:
            cur.eps_estimate = _f(e.get("estimate"))
    return [out[p] for p in sorted(out)]


def finnhub_rows(ticker: str, key: str, today: date, http: httpx.Client) -> tuple[list[dict], list[dict]]:
    res = http.get(f"{FINNHUB}/calendar/earnings", params={
        "symbol": ticker, "from": (today - timedelta(days=365 * YEARS + 30)).isoformat(), "to": today.isoformat(), "token": key,
    })
    res.raise_for_status()
    calendar = res.json().get("earningsCalendar") or []
    try:
        res = http.get(f"{FINNHUB}/stock/earnings", params={"symbol": ticker, "token": key})
        res.raise_for_status()
        earnings = res.json() if isinstance(res.json(), list) else []
    except Exception as e:
        log.info("%s EPS 예상치(earnings) 받기 실패: %s", ticker, e)
        earnings = []
    return calendar, earnings


# ---------------------------------------------------------------- 국내(네이버 분기 실적 표)

ROWS = {"revenue": ("매출액", "매출", "영업수익"), "op": ("영업이익",), "net": ("당기순이익", "순이익")}
KEY = re.compile(r"^(\d{4})(\d{2})")


def _row_key(title: str) -> str | None:
    t = re.sub(r"\s|\(.*?\)", "", title or "")
    if t.upper().startswith("EPS"):
        return "eps"
    return next((k for k, names in ROWS.items() if t in names), None)


def naver_estimates(ticker: str, body: dict) -> list[Estimate]:
    """분기 표에서 예상(isConsensus=Y) 칸만 꺼내요. 표 모양이 다르면 빈 목록."""
    info = body.get("financeInfo", body) if isinstance(body, dict) else {}
    titles = info.get("trTitleList") or []
    rows = info.get("rowList") or []
    cons = []
    for t in titles:
        m = KEY.match(str(t.get("key") or ""))
        if m and str(t.get("isConsensus") or "").upper() == "Y" and 1 <= int(m.group(2)) <= 12:
            cons.append((t["key"], f"{m.group(1)}Q{(int(m.group(2)) - 1) // 3 + 1}"))
    out = []
    for key, period in cons:
        vals: dict[str, float | None] = {}
        for r in rows:
            k = _row_key(r.get("title", ""))
            if not k or k in vals:
                continue
            col = (r.get("columns") or {}).get(key)
            vals[k] = _f(col.get("value") if isinstance(col, dict) else col)
        if not any(v is not None for v in vals.values()):
            continue
        mul = lambda v: None if v is None else v * EOK  # noqa: E731
        out.append(Estimate(ticker, period, "KR", "naver", eps_estimate=vals.get("eps"), revenue_estimate=mul(vals.get("revenue")),
                            op_estimate=mul(vals.get("op")), net_estimate=mul(vals.get("net"))))
    return out


def naver_quarter(ticker: str, http: httpx.Client) -> dict:
    res = http.get(NAVER_QUARTER.format(ticker), headers={"User-Agent": BROWSER_UA, "Referer": "https://m.stock.naver.com/"})
    res.raise_for_status()
    return res.json()


# ---------------------------------------------------------------- 저장

def reported_periods(conn: psycopg.Connection, ticker: str) -> set[str]:
    rows = conn.execute(
        """SELECT period FROM earnings_reports WHERE ticker = %s
           UNION SELECT period FROM earnings_filings WHERE ticker = %s""", (ticker, ticker)).fetchall()
    return {r[0] for r in rows}


def save(conn: psycopg.Connection, rows: list[Estimate], today: date) -> int:
    """미국은 받은 그대로 덮어쓰고, 국내 예상치는 그 분기 실적이 나오기 전까지만 고쳐요(발표 직전 값이 남도록)."""
    done = 0
    locked: dict[str, set[str]] = {}
    for e in rows:
        if e.source == "naver":
            if e.ticker not in locked:
                locked[e.ticker] = reported_periods(conn, e.ticker)
            if e.period in locked[e.ticker]:
                continue
        conn.execute(
            """INSERT INTO earnings_estimates (ticker, period, market, source, eps_actual, eps_estimate, revenue_actual, revenue_estimate,
                 op_estimate, net_estimate, reported_on, hour, as_of)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, period) DO UPDATE SET market = EXCLUDED.market, source = EXCLUDED.source,
                 eps_actual = COALESCE(EXCLUDED.eps_actual, earnings_estimates.eps_actual),
                 eps_estimate = COALESCE(EXCLUDED.eps_estimate, earnings_estimates.eps_estimate),
                 revenue_actual = COALESCE(EXCLUDED.revenue_actual, earnings_estimates.revenue_actual),
                 revenue_estimate = COALESCE(EXCLUDED.revenue_estimate, earnings_estimates.revenue_estimate),
                 op_estimate = COALESCE(EXCLUDED.op_estimate, earnings_estimates.op_estimate),
                 net_estimate = COALESCE(EXCLUDED.net_estimate, earnings_estimates.net_estimate),
                 reported_on = COALESCE(EXCLUDED.reported_on, earnings_estimates.reported_on),
                 hour = COALESCE(NULLIF(EXCLUDED.hour, ''), earnings_estimates.hour), as_of = EXCLUDED.as_of""",
            (e.ticker, e.period, e.market, e.source, e.eps_actual, e.eps_estimate, e.revenue_actual, e.revenue_estimate,
             e.op_estimate, e.net_estimate, e.reported_on, e.hour, today),
        )
        done += 1
    return done
