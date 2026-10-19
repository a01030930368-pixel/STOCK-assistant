"""매크로 지표를 무료 공공 API에서 가져옵니다.

- 한국은행 ECOS: 기준금리, 원/달러 환율, 소비자물가 (https://ecos.bok.or.kr/api, 무료 키)
- 미국 FRED: 연준 기준금리 상단, 미국 소비자물가 (https://fred.stlouisfed.org, 무료 키)
"""
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

import httpx

ECOS_URL = "https://ecos.bok.or.kr/api/StatisticSearch"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


@dataclass(frozen=True)
class Indicator:
    code: str
    value: Decimal
    as_of: str  # 지표 기준 시점(예: 202609, 20261017, 2026-10-17)


def _ecos_rows(http: httpx.Client, key: str, stat: str, cycle: str, start: str, end: str, item: str) -> list[dict]:
    res = http.get(f"{ECOS_URL}/{key}/json/kr/1/100/{stat}/{cycle}/{start}/{end}/{item}")
    res.raise_for_status()
    body = res.json()
    if "StatisticSearch" not in body:
        result = body.get("RESULT", {})
        raise RuntimeError(f"ECOS 오류 {stat}: {result.get('CODE')} {result.get('MESSAGE')}")
    return sorted(body["StatisticSearch"].get("row", []), key=lambda r: r["TIME"])


def _fred_rows(http: httpx.Client, key: str, series: str, **params: str) -> list[dict]:
    res = http.get(FRED_URL, params={"series_id": series, "api_key": key, "file_type": "json",
                                     "sort_order": "desc", "limit": "5", **params})
    res.raise_for_status()
    # 값이 아직 없는 날은 "."으로 옵니다.
    return [o for o in res.json().get("observations", []) if o.get("value") not in (None, "", ".")]


def yoy(rows: list[dict]) -> Indicator | None:
    """월별 지수(오래된 순)에서 최신 달의 전년 동월 대비 상승률(%)을 계산합니다."""
    by_time = {r["TIME"]: Decimal(r["DATA_VALUE"]) for r in rows}
    latest = rows[-1]["TIME"] if rows else None
    if not latest:
        return None
    prev = f"{int(latest[:4]) - 1}{latest[4:]}"
    if prev not in by_time or by_time[prev] == 0:
        return None
    pct = (by_time[latest] / by_time[prev] - 1) * 100
    return Indicator("kr_cpi_yoy", pct.quantize(Decimal("0.01")), latest)


def fetch_ecos(key: str, today: date, http: httpx.Client) -> list[Indicator]:
    month = today.strftime("%Y%m")
    out = []
    rows = _ecos_rows(http, key, "722Y001", "M", f"{today.year - 1}01", month, "0101000")
    if rows:
        out.append(Indicator("kr_base_rate", Decimal(rows[-1]["DATA_VALUE"]), rows[-1]["TIME"]))
    start = (today - timedelta(days=14)).strftime("%Y%m%d")
    rows = _ecos_rows(http, key, "731Y001", "D", start, today.strftime("%Y%m%d"), "0000001")
    if rows:
        out.append(Indicator("usdkrw", Decimal(rows[-1]["DATA_VALUE"]), rows[-1]["TIME"]))
    rows = _ecos_rows(http, key, "901Y009", "M", f"{today.year - 2}01", month, "0")
    if (cpi := yoy(rows)) is not None:
        out.append(cpi)
    return out


def fetch_fred(key: str, http: httpx.Client) -> list[Indicator]:
    out = []
    if rows := _fred_rows(http, key, "DFEDTARU"):
        out.append(Indicator("us_base_rate", Decimal(rows[0]["value"]), rows[0]["date"]))
    # units=pc1: 전년 동기 대비 변화율(%)
    if rows := _fred_rows(http, key, "CPIAUCSL", units="pc1"):
        out.append(Indicator("us_cpi_yoy", Decimal(rows[0]["value"]).quantize(Decimal("0.01")), rows[0]["date"]))
    return out
