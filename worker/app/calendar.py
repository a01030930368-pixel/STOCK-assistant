"""다가오는 일정: 한국·미국 휴장일과 보유 종목 실적 발표 예정일.

휴장일은 holidays 라이브러리의 거래소 달력(XKRX, XNYS)을 씁니다. 키가 필요 없습니다.
미국 실적 발표 예정일은 Finnhub 실적 달력에서 가져옵니다. 국내 실적 예정일은 무료로 미리 공개되는 자료가 없습니다.
"""
from dataclasses import dataclass
from datetime import date, timedelta

import holidays
import httpx

FINNHUB = "https://finnhub.io/api/v1"
EXCHANGES = {"KR": "XKRX", "US": "XNYS"}
# 영어 휴일 이름을 한국어로 보여 줍니다. 없는 이름은 영어 그대로 둡니다.
US_NAMES = {
    "New Year's Day": "새해", "Martin Luther King Jr. Day": "마틴 루터 킹 데이", "Washington's Birthday": "대통령의 날",
    "Good Friday": "성금요일", "Memorial Day": "현충일(미국)", "Juneteenth National Independence Day": "준틴스",
    "Independence Day": "독립기념일", "Labor Day": "노동절", "Thanksgiving Day": "추수감사절", "Christmas Day": "크리스마스",
}
HOURS = {"bmo": "장 시작 전", "amc": "장 마감 후", "dmh": "장중"}


@dataclass(frozen=True)
class Event:
    day: date
    kind: str  # holiday | earnings
    market: str
    ticker: str
    title: str
    detail: str = ""


def _us_name(name: str) -> str:
    observed = name.endswith(" (observed)")
    base = name.removesuffix(" (observed)")
    return US_NAMES.get(base, base) + (" 대체 휴장" if observed else "")


def market_holidays(market: str, years: list[int]) -> dict[date, str]:
    return dict(holidays.financial_holidays(EXCHANGES[market], years=years, language="ko" if market == "KR" else None))


def is_holiday(market: str, day: date) -> bool:
    return day in holidays.financial_holidays(EXCHANGES[market], years=[day.year])


def holiday_events(today: date, days: int = 120) -> list[Event]:
    end = today + timedelta(days=days)
    out = []
    for market in EXCHANGES:
        for day, name in sorted(market_holidays(market, sorted({today.year, end.year})).items()):
            if today <= day <= end:
                title = name if market == "KR" else _us_name(name)
                out.append(Event(day, "holiday", market, "", f"{'한국' if market == 'KR' else '미국'} 휴장 · {title}"))
    return out


def finnhub_earnings_calendar(ticker: str, name: str, key: str, today: date, http: httpx.Client, days: int = 120) -> list[Event]:
    res = http.get(f"{FINNHUB}/calendar/earnings", params={
        "symbol": ticker, "from": today.isoformat(), "to": (today + timedelta(days=days)).isoformat(), "token": key,
    })
    res.raise_for_status()
    out = []
    for e in res.json().get("earningsCalendar") or []:
        if not e.get("date"):
            continue
        parts = [f"{e['year']}년 {e['quarter']}분기"] if e.get("year") and e.get("quarter") else []
        if HOURS.get(e.get("hour") or ""):
            parts.append(HOURS[e["hour"]])
        if e.get("epsEstimate") is not None:
            parts.append(f"예상 EPS {e['epsEstimate']}")
        out.append(Event(date.fromisoformat(e["date"]), "earnings", "US", ticker, f"{name} 실적 발표", " · ".join(parts)))
    return out
