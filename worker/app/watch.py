"""관심종목 현재가와 종목 업종 이름.

관심종목은 잔고에 없어서 현재가를 따로 받아야 목표가 알림을 걸 수 있습니다.
업종은 포트폴리오 비중을 업종별로 묶는 데 씁니다.
"""
from dataclasses import dataclass
from decimal import Decimal

import httpx

from .intraday import UA, YAHOO
from .kiwoom import parse_number, parse_price

FINNHUB = "https://finnhub.io/api/v1"


@dataclass(frozen=True)
class Quote:
    ticker: str
    price: Decimal
    change_pct: Decimal | None


def parse_kr_quote(ticker: str, body: dict) -> Quote:
    # ka10001 주식기본정보: cur_prc 현재가(부호 붙음), flu_rt 등락률
    price = parse_price(body.get("cur_prc"))
    if price <= 0:
        raise ValueError(f"키움 현재가가 비어 있습니다 ({ticker})")
    rate = body.get("flu_rt")
    return Quote(ticker, price, parse_number(rate) if rate not in (None, "") else None)


def parse_yahoo_quote(ticker: str, body: dict) -> Quote:
    result = ((body.get("chart") or {}).get("result") or [None])[0]
    meta = (result or {}).get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        raise ValueError(f"야후 현재가가 비어 있습니다 ({ticker})")
    price = round(Decimal(str(price)), 4)
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = round((price / Decimal(str(prev)) - 1) * 100, 2) if prev else None
    return Quote(ticker, price, change)


def yahoo_quote(ticker: str, http: httpx.Client) -> Quote:
    res = http.get(f"{YAHOO}{ticker.upper()}", params={"interval": "1d", "range": "1d"}, headers={"User-Agent": UA})
    res.raise_for_status()
    return parse_yahoo_quote(ticker, res.json())


def parse_kr_sector(body: dict) -> str:
    # ka10100 종목정보 조회: upName 업종명. 이름이 다르면 항목 이름을 담아 오류를 내 로그로 고칠 수 있게 합니다.
    name = str(body.get("upName") or "").strip()
    if not name:
        raise ValueError(f"키움 업종명이 비어 있습니다. 응답 항목: {', '.join(sorted(body))}")
    return name


# Finnhub 업종 이름 중 자주 나오는 것만 한국어로 바꿉니다. 없는 이름은 영어 그대로 둡니다.
INDUSTRY_KO = {
    "Semiconductors": "반도체", "Technology": "기술", "Software": "소프트웨어", "Automobiles": "자동차",
    "Media": "미디어", "Retail": "유통", "Banking": "은행", "Financial Services": "금융",
    "Insurance": "보험", "Pharmaceuticals": "제약", "Biotechnology": "바이오", "Health Care": "헬스케어",
    "Energy": "에너지", "Utilities": "유틸리티", "Telecommunication": "통신", "Aerospace & Defense": "항공·방산",
    "Machinery": "기계", "Electrical Equipment": "전기장비", "Chemicals": "화학", "Metals & Mining": "금속·광업",
    "Real Estate": "부동산", "Hotels, Restaurants & Leisure": "호텔·레저", "Beverages": "음료",
    "Food Products": "식품", "Airlines": "항공", "Logistics & Transportation": "운송", "Communications": "통신",
    "Consumer products": "소비재", "Road & Rail": "운송", "Building": "건설", "Construction": "건설",
}


def finnhub_sector(ticker: str, key: str, http: httpx.Client) -> str:
    res = http.get(f"{FINNHUB}/stock/profile2", params={"symbol": ticker.upper()}, headers={"X-Finnhub-Token": key})
    res.raise_for_status()
    name = str((res.json() or {}).get("finnhubIndustry") or "").strip()
    if not name:
        raise ValueError(f"Finnhub 업종이 비어 있습니다 ({ticker})")
    return INDUSTRY_KO.get(name, name)
