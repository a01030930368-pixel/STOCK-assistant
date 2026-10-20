"""다가오는 일정: 한국·미국 휴장일, 보유 종목 실적 발표 예정일, 시장 전체에 영향을 주는 경제 일정.

휴장일은 holidays 라이브러리의 거래소 달력(XKRX, XNYS)을 씁니다. 키가 필요 없습니다.
미국 실적 발표 예정일은 Finnhub 실적 달력에서 가져옵니다. 국내는 DART '기업설명회(IR) 개최 안내' 공시로 찾습니다(research.dart_ir_earnings).
경제 일정은 세 가지입니다. 미국 지표 발표일(CPI·고용·GDP 등)은 FRED 발표 달력에서 받고(FRED 키 필요),
FOMC와 한국은행 금통위 날짜는 두 기관이 미리 공개한 일정을 적어 두며, 선물·옵션 만기일은 규칙으로 계산합니다.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import holidays
import httpx

FINNHUB = "https://finnhub.io/api/v1"
FRED = "https://api.stlouisfed.org/fred/release/dates"
NY, KST = ZoneInfo("America/New_York"), ZoneInfo("Asia/Seoul")
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
    kind: str  # holiday | earnings | policy(금리 결정·만기) | economic(미국 지표 발표) | dividend(배당락)
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


# FOMC 금리 결정일(회의 둘째 날, 미국 동부 14:00 발표). 연준 공개 일정, 2027년은 잠정.
FOMC = [date(2026, 1, 28), date(2026, 3, 18), date(2026, 4, 29), date(2026, 6, 17), date(2026, 7, 29), date(2026, 9, 16),
        date(2026, 10, 28), date(2026, 12, 9), date(2027, 1, 27), date(2027, 3, 17), date(2027, 4, 28), date(2027, 6, 9),
        date(2027, 7, 28), date(2027, 9, 15), date(2027, 10, 27), date(2027, 12, 8)]
# 한국은행 금통위 통화정책방향 결정회의(기준금리 발표). 다음 해 일정은 보통 연말에 나와 그때 덧붙입니다.
BOK = [date(2026, 1, 15), date(2026, 2, 26), date(2026, 4, 10), date(2026, 5, 28), date(2026, 7, 16), date(2026, 8, 27),
       date(2026, 10, 22), date(2026, 11, 26)]
# FRED 발표 번호, 이름, 미국 동부 발표 시각
US_RELEASES = [
    (10, "미국 CPI(소비자물가)", time(8, 30)),
    (50, "미국 고용보고서(비농업 고용·실업률)", time(8, 30)),
    (46, "미국 PPI(생산자물가)", time(8, 30)),
    (9, "미국 소매판매", time(8, 30)),
    (53, "미국 GDP", time(8, 30)),
    (54, "미국 PCE 물가(개인소득·지출)", time(8, 30)),
]


def _kst(day: date, at: time) -> str:
    """미국 동부 시각을 한국 시각으로 바꿔 '한국 시간 22:30'처럼 적습니다. 서머타임에 따라 달라집니다."""
    k = datetime.combine(day, at, NY).astimezone(KST)
    nxt = " 다음 날" if k.date() > day else ""
    return f"미국 동부 {at:%H:%M} · 한국 시간{nxt} {k:%H:%M}"


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _trading_day_on_or_before(market: str, day: date) -> date:
    while day.weekday() >= 5 or is_holiday(market, day):
        day -= timedelta(days=1)
    return day


def expiry_events(today: date, days: int = 120) -> list[Event]:
    """국내 옵션 만기(매달 둘째 목요일, 3·6·9·12월은 선물까지 동시만기)와 미국 쿼드러플 위칭(3·6·9·12월 셋째 금요일)."""
    end = today + timedelta(days=days)
    out = []
    y, m = today.year, today.month
    while date(y, m, 1) <= end:
        quarter = m in (3, 6, 9, 12)
        kr = _trading_day_on_or_before("KR", _nth_weekday(y, m, 3, 2))
        out.append(Event(kr, "policy", "KR", "", "국내 선물·옵션 동시만기" if quarter else "국내 옵션 만기",
                         "장 마감 무렵 거래량과 변동성이 커질 수 있어요"))
        if quarter:
            us = _trading_day_on_or_before("US", _nth_weekday(y, m, 4, 3))
            out.append(Event(us, "policy", "US", "", "미국 쿼드러플 위칭(선물·옵션 동시만기)", "장 마감 무렵 거래량과 변동성이 커질 수 있어요"))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return [e for e in out if today <= e.day <= end]


def policy_events(today: date, days: int = 120) -> list[Event]:
    end = today + timedelta(days=days)
    out = [Event(d, "policy", "US", "", "FOMC 금리 결정", _kst(d, time(14, 0)) + " · 30분 뒤 의장 기자회견") for d in FOMC if today <= d <= end]
    out += [Event(d, "policy", "KR", "", "한국은행 기준금리 결정", "금통위 통화정책방향 회의 · 오전 발표 뒤 총재 기자간담회")
            for d in BOK if today <= d <= end]
    return sorted(out + expiry_events(today, days), key=lambda e: e.day)


def fred_release_events(key: str, today: date, http: httpx.Client, days: int = 120) -> list[Event]:
    end = today + timedelta(days=days)
    out = []
    for rid, title, at in US_RELEASES:
        # FRED는 키를 주소로만 받습니다. 로그에는 logsafe가 키를 가려 줍니다.
        res = http.get(FRED, params={
            "release_id": rid, "api_key": key, "file_type": "json", "realtime_start": today.isoformat(),
            "include_release_dates_with_no_data": "true", "sort_order": "asc",
        })
        res.raise_for_status()
        for r in res.json().get("release_dates") or []:
            day = date.fromisoformat(r["date"])
            if today <= day <= end:
                out.append(Event(day, "economic", "US", "", title, _kst(day, at)))
    return sorted(set(out), key=lambda e: (e.day, e.title))
