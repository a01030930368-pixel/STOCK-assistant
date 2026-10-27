"""매크로 환경 › 국내·해외 탭의 지수 일봉을 모아요. sector_daily에 market 'MK'로 넣어요.

- 주가지수·환율·원자재·비트코인: 야후 일봉(키 없이). 날짜는 그 거래소 시간대로 맞춰요(코스피는 한국 날짜).
- 국고채 3년·10년: 한국은행 ECOS 시장금리(일별). ECOS 키가 있어야 해요.
- 미국 10년 금리: 야후 ^TNX, 안 되면 FRED DGS10. 미국 2년 금리: FRED DGS2(FRED 키가 있어야 해요).
- 공포·탐욕 지수: CNN 차트 데이터(키 없이, 비공식). 날짜는 뉴욕 날짜예요.
처음 켤 때 2년 치를 받고, 그 뒤로는 30분마다 최근 며칠만 다시 받아요(오늘 봉은 그때그때 바뀌어요).
"""
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import db, intraday, macro

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")
EVERY = timedelta(minutes=30)
FIRST_DAYS = 760  # 처음 받을 기간(1년 차트 + 여유)
AGAIN_DAYS = 10

# (우리 코드, 어디서, 그쪽 이름). 화면 이름·단위는 web/src/lib/markets.ts에 있어요.
SERIES = [
    ("KOSPI", "yahoo", "^KS11"), ("KOSDAQ", "yahoo", "^KQ11"), ("KOSPI200", "yahoo", "^KS200"),
    ("USDKRW", "yahoo", "KRW=X"), ("JPYKRW", "yahoo", "JPYKRW=X"),
    ("KR3Y", "ecos", "010200000"), ("KR10Y", "ecos", "010210000"),
    ("SPX", "yahoo", "^GSPC"), ("NASDAQ", "yahoo", "^IXIC"), ("DOW", "yahoo", "^DJI"), ("SOX", "yahoo", "^SOX"),
    ("VIX", "yahoo", "^VIX"), ("US10Y", "yahoo", "^TNX"), ("US2Y", "fred", "DGS2"),
    ("DXY", "yahoo", "DX-Y.NYB"), ("WTI", "yahoo", "CL=F"), ("GOLD", "yahoo", "GC=F"), ("BTC", "yahoo", "BTC-USD"),
    ("FEARGREED", "cnn", ""),
]
CNN = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/"
# CNN은 브라우저가 아니면 418을 돌려줘요.
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
NY = ZoneInfo("America/New_York")
FALLBACK = {"US10Y": ("fred", "DGS10")}


def yahoo_closes(body: dict) -> list[tuple[date, Decimal]]:
    """야후 일봉 응답을 (날짜, 종가)로. 날짜는 응답에 적힌 거래소 시간대 기준이에요."""
    result = ((body.get("chart") or {}).get("result") or [{}])[0] or {}
    tz = ZoneInfo((result.get("meta") or {}).get("exchangeTimezoneName") or "America/New_York")
    out = {b.ts.astimezone(tz).date(): b.close for b in intraday.parse_yahoo(body)}
    return sorted(out.items())


def scale(code: str, closes: list) -> list:
    """원/엔은 100엔 기준으로, ^TNX가 10배로 오면(42.1) 금리(4.21)로 바꿔요."""
    if code == "JPYKRW":
        return [(d, c * 100) for d, c in closes]
    if code == "US10Y" and closes and closes[-1][1] > 20:
        return [(d, c / 10) for d, c in closes]
    return closes


def cnn_closes(body: dict) -> list[tuple[date, Decimal]]:
    """CNN 공포·탐욕 응답을 (뉴욕 날짜, 점수)로. 과거 목록(x=밀리초, y=점수)에 지금 점수를 오늘 값으로 더해요."""
    out: dict[date, Decimal] = {}
    for p in (body.get("fear_and_greed_historical") or {}).get("data") or []:
        if p.get("x") is not None and p.get("y") is not None:
            out[datetime.fromtimestamp(p["x"] / 1000, timezone.utc).astimezone(NY).date()] = round(Decimal(str(p["y"])), 1)
    now = body.get("fear_and_greed") or {}
    if now.get("score") is not None and now.get("timestamp"):
        day = datetime.fromisoformat(str(now["timestamp"]).replace("Z", "+00:00")).astimezone(NY).date()
        out[day] = round(Decimal(str(now["score"])), 1)
    if not out:
        raise ValueError("CNN 공포·탐욕 응답이 비어 있어요")
    return sorted(out.items())


def ecos_closes(rows: list[dict]) -> list[tuple[date, Decimal]]:
    out = []
    for r in rows:
        t, v = str(r.get("TIME", "")), r.get("DATA_VALUE")
        if len(t) == 8 and v not in (None, ""):
            out.append((date(int(t[:4]), int(t[4:6]), int(t[6:])), Decimal(str(v))))
    return out


def fred_closes(rows: list[dict]) -> list[tuple[date, Decimal]]:
    return sorted((date.fromisoformat(o["date"]), Decimal(o["value"])) for o in rows)


class MarketsJob:
    def __init__(self, cfg, http: httpx.Client):
        self.cfg = cfg
        self.http = http
        self.last: datetime | None = None
        self.full: set[str] = set()  # 이번에 켠 뒤 긴 기간을 받은 코드

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if self.last and now - self.last < EVERY:
            return
        self.last = now
        today = now.astimezone(KST).date()
        errors: dict[str, str] = {}
        for code, source, name in SERIES:
            days = AGAIN_DAYS if code in self.full else FIRST_DAYS
            try:
                closes = self._fetch(code, source, name, today, days)
            except Exception as e:
                alt = FALLBACK.get(code)
                try:
                    if not alt:
                        raise
                    closes = self._fetch(code, alt[0], alt[1], today, days)
                    if closes is None:
                        raise e
                except Exception as e2:
                    log.warning("%s 지수 받기 실패: %s", code, e2 if alt else e)
                    errors[code] = str(e2 if alt else e)[:120]
                    continue
            if closes is None:
                continue  # 키가 없는 출처
            db.save_sector_daily(conn, "MK", code, scale(code, closes))
            self.full.add(code)
        db.set_setting(conn, "markets_status", {"at": now.isoformat(), "ok": not errors, "errors": errors})

    def _fetch(self, code: str, source: str, name: str, today: date, days: int):
        start = today - timedelta(days=days)
        if source == "yahoo":
            span = "5d" if days <= AGAIN_DAYS else "2y"
            res = self.http.get(f"{intraday.YAHOO}{name}", params={"interval": "1d", "range": span}, headers={"User-Agent": intraday.UA})
            res.raise_for_status()
            return yahoo_closes(res.json())
        if source == "cnn":
            res = self.http.get(f"{CNN}{start.isoformat()}", headers={"User-Agent": BROWSER_UA, "Accept": "application/json",
                                                                    "Referer": "https://edition.cnn.com/"})
            res.raise_for_status()
            return cnn_closes(res.json())
        if source == "ecos":
            if not self.cfg.ecos_api_key:
                return None
            return ecos_closes(macro._ecos_rows(self.http, self.cfg.ecos_api_key, "817Y002", "D",
                                                start.strftime("%Y%m%d"), today.strftime("%Y%m%d"), name, 1000))
        if source == "fred":
            if not self.cfg.fred_api_key:
                return None
            return fred_closes(macro._fred_rows(self.http, self.cfg.fred_api_key, name, sort_order="asc",
                                                limit="1000", observation_start=start.isoformat()))
        raise ValueError(f"모르는 출처 {source}")
