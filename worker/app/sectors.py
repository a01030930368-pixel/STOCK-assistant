"""섹터 동향: 국내 코스피 업종지수와 미국 S&P 500 섹터 ETF.

국내는 키움 ka20003(전업종지수)으로 지금 지수·등락률·비중을, ka20006(업종일봉)으로 지난 종가를 받아요.
미국은 섹터 ETF 11개의 일봉(야후)으로 같은 값을 만들어요. 기간별 등락(1주·1달·3달·올해)은 화면에서 종가로 계산해요.
"""
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from .kiwoom import parse_number, parse_price

KEEP_DAYS = 400  # 올해 첫날 직전 종가까지 남도록 1년 반 정도


@dataclass
class Sector:
    market: str
    code: str
    name: str
    price: Decimal
    change_pct: Decimal
    weight: Decimal | None = None
    leaders: list[dict] = field(default_factory=list)


# 코스피 전체·크기별·묶음 지수는 섹터가 아니라서 빼요.
NOT_SECTOR = {"001", "002", "003", "004"}
NOT_SECTOR_NAME = re.compile(r"종합|대형|중형|소형|^제조|KOSPI|코스피|KRX|\d")


def parse_all_sectors(body: dict) -> list[Sector]:
    """ka20003 all_inds_idex: stk_cd 업종코드, stk_nm 업종명, cur_prc 지수(부호 붙음), flu_rt 등락률, wght 비중."""
    rows = body.get("all_inds_idex") or []
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"키움 전업종지수가 비어 있어요. 응답 항목: {', '.join(sorted(body))}")
    out = []
    for r in rows:
        code, name = str(r.get("stk_cd", "")).strip(), str(r.get("stk_nm", "")).strip()
        price = parse_price(r.get("cur_prc"))
        if not code or not name or price <= 0 or code in NOT_SECTOR or NOT_SECTOR_NAME.search(name):
            continue
        weight = parse_number(r.get("wght")) if str(r.get("wght") or "").strip() else None
        out.append(Sector("KR", code, name, price, parse_number(r.get("flu_rt")), weight if weight and weight > 0 else None))
    if not out:
        raise ValueError(f"키움 전업종지수에서 섹터를 찾지 못했어요. 첫 줄 항목: {', '.join(sorted(rows[0]))}")
    return out


def parse_sector_daily(body: dict, price: Decimal | None = None) -> list[tuple[date, Decimal]]:
    """ka20006 inds_dt_pole_qry: dt 날짜, cur_prc 종가. 소수점 없이 100배로 오면 지금 지수와 비교해 되돌려요."""
    out = []
    for r in body.get("inds_dt_pole_qry") or []:
        day, raw = str(r.get("dt", "")).strip(), str(r.get("cur_prc", "")).strip()
        close = parse_price(raw)
        if len(day) != 8 or close <= 0:
            continue
        out.append((date(int(day[:4]), int(day[4:6]), int(day[6:])), close))
    out.sort()
    if out and price and price > 0 and out[-1][1] / price > 50:
        out = [(d, c / 100) for d, c in out]
    return out[-KEEP_DAYS:]


def parse_leaders(body: dict, n: int = 2) -> list[dict]:
    """ka20002 inds_stkpc: 업종 안에서 오늘 가장 크게 움직인 종목 n개 {name, pct}."""
    rows = []
    for r in body.get("inds_stkpc") or []:
        name = str(r.get("stk_nm", "")).strip()
        if name and str(r.get("flu_rt", "")).strip():
            rows.append({"name": name, "pct": float(parse_number(r.get("flu_rt")))})
    return sorted(rows, key=lambda x: -abs(x["pct"]))[:n]


# 미국 섹터 ETF (SPDR). 비중은 S&P 500 안의 대략적인 시가총액 비중이라 지도 네모 크기에만 써요.
US_SECTORS = [
    ("XLK", "기술", 32), ("XLF", "금융", 13), ("XLY", "임의소비재", 10), ("XLC", "통신서비스", 10),
    ("XLV", "헬스케어", 9), ("XLI", "산업재", 8), ("XLP", "필수소비재", 5), ("XLE", "에너지", 3),
    ("XLU", "유틸리티", 2.5), ("XLRE", "부동산", 2), ("XLB", "소재", 2),
]
# 섹터마다 큰 종목 셋. 오늘 많이 움직인 종목을 고를 때만 써요.
US_TOP = {
    "XLK": ["NVDA", "MSFT", "AAPL"], "XLF": ["BRK-B", "JPM", "V"], "XLY": ["AMZN", "TSLA", "HD"],
    "XLC": ["META", "GOOGL", "NFLX"], "XLV": ["LLY", "JNJ", "ABBV"], "XLI": ["GE", "CAT", "RTX"],
    "XLP": ["COST", "WMT", "PG"], "XLE": ["XOM", "CVX", "COP"], "XLU": ["NEE", "SO", "CEG"],
    "XLRE": ["PLD", "AMT", "WELL"], "XLB": ["LIN", "SHW", "ECL"],
}


def day_change(closes: list[Decimal]) -> Decimal:
    if len(closes) < 2 or closes[-2] <= 0:
        return Decimal(0)
    return ((closes[-1] / closes[-2] - 1) * 100).quantize(Decimal("0.01"))
