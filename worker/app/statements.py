"""종목 페이지 재무제표: 손익계산서·재무상태표·현금흐름표의 연간·분기 값.

국내: OpenDART 단일회사 전체 재무제표(사업·반기·분기보고서). 분기 손익·현금흐름은 보고서마다 누적이라 앞 보고서를 빼서 석 달 값을 만들어요.
미국: SEC EDGAR companyfacts의 frame(달력 기준 연도·분기). 4분기는 1년 값에서 1~3분기를 빼서 만들어요.

한 줄 = (kind, period, item, value). kind는 Y(연간 "2025"), Q(분기 "2025Q3"), C(올해 누적 "2026Q3").
"""
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import httpx

from .research import SEC_FACTS, _amount, _dart_json

FLOW = ("revenue", "cost_of_sales", "gross_profit", "operating_income", "net_income", "cfo", "cfi", "cff", "capex")
STOCK = ("assets", "cash", "liabilities", "equity")
CASH = ("cfo", "cfi", "cff", "capex")


@dataclass(frozen=True)
class Line:
    kind: str
    period: str
    item: str
    value: Decimal


# ---------------------------------------------------------------- 국내(DART)

# (찾을 표, 표준 계정 ID, 계정명). 표준 ID가 없는 회사도 있어 계정명으로 한 번 더 찾아요.
# 자본변동표에도 '당기순이익'이 있어서 표를 꼭 정해서 찾습니다.
DART_ITEMS = {
    "revenue": (("IS", "CIS"), ("ifrs-full_Revenue",), ("매출액", "영업수익", "수익(매출액)", "매출")),
    "cost_of_sales": (("IS", "CIS"), ("ifrs-full_CostOfSales",), ("매출원가", "영업비용")),
    "gross_profit": (("IS", "CIS"), ("ifrs-full_GrossProfit",), ("매출총이익", "매출총이익(손실)")),
    "operating_income": (("IS", "CIS"), ("dart_OperatingIncomeLoss",), ("영업이익", "영업이익(손실)")),
    "net_income": (("IS", "CIS"), ("ifrs-full_ProfitLoss",), ("당기순이익", "당기순이익(손실)", "분기순이익", "분기순이익(손실)", "반기순이익", "반기순이익(손실)")),
    "assets": (("BS",), ("ifrs-full_Assets",), ("자산총계",)),
    "cash": (("BS",), ("ifrs-full_CashAndCashEquivalents",), ("현금및현금성자산",)),
    "liabilities": (("BS",), ("ifrs-full_Liabilities",), ("부채총계",)),
    "equity": (("BS",), ("ifrs-full_Equity",), ("자본총계",)),
    "cfo": (("CF",), ("ifrs-full_CashFlowsFromUsedInOperatingActivities",), ("영업활동현금흐름", "영업활동으로인한현금흐름")),
    "cfi": (("CF",), ("ifrs-full_CashFlowsFromUsedInInvestingActivities",), ("투자활동현금흐름", "투자활동으로인한현금흐름")),
    "cff": (("CF",), ("ifrs-full_CashFlowsFromUsedInFinancingActivities",), ("재무활동현금흐름", "재무활동으로인한현금흐름")),
    "capex": (("CF",), ("ifrs-full_PurchaseOfPropertyPlantAndEquipment",), ("유형자산의취득",)),
}
# 보고서 코드 -> 몇 분기까지 누적인지
REPORTS = {"11013": 1, "11012": 2, "11014": 3, "11011": 4}


def _norm(name: str) -> str:
    return re.sub(r"\s", "", name or "")


def dart_values(rows: list[dict], column: str, add_column: str | None = None) -> dict[str, Decimal]:
    """보고서 한 건에서 항목별 값. 손익은 add_column(누적)이 있으면 그걸 써요."""
    out = {}
    for item, (divs, ids, names) in DART_ITEMS.items():
        hit = None
        for div in divs:
            pool = [r for r in rows if r.get("sj_div") == div]
            hit = next((r for r in pool if r.get("account_id") in ids), None) or next((r for r in pool if _norm(r.get("account_nm")) in names), None)
            if hit:
                break
        if not hit:
            continue
        raw = hit.get(add_column) if add_column and divs[0] == "IS" and hit.get(add_column) not in (None, "", "-") else hit.get(column)
        v = _amount(raw)
        if v is not None:
            out[item] = abs(v) if item == "capex" else v
    return out


def _fcf(values: dict[str, Decimal]) -> dict[str, Decimal]:
    if "cfo" in values and "capex" in values:
        values = {**values, "fcf": values["cfo"] - values["capex"]}
    return values


def from_dart(reports: dict[tuple[int, int], list[dict]]) -> list[Line]:
    """reports: {(연도, 몇 분기 누적): DART 행들}. 4 = 사업보고서."""
    cum: dict[tuple[int, int], dict[str, Decimal]] = {}
    lines: list[Line] = []
    for (year, q), rows in reports.items():
        cum[(year, q)] = dart_values(rows, "thstrm_amount", None if q == 4 else "thstrm_add_amount")
        if q == 4:
            # 사업보고서에는 전기·전전기 값도 있어요.
            for back, column in ((1, "frmtrm_amount"), (2, "bfefrmtrm_amount")):
                if (year - back, 4) not in reports:
                    cum.setdefault((year - back, 4), dart_values(rows, column))
    for (year, q), values in cum.items():
        if q == 4:
            lines += [Line("Y", str(year), k, v) for k, v in _fcf(values).items()]
            if (year, 3) not in cum:  # 분기 보고서가 없는 해(전기·전전기)는 연간만
                continue
        # 분기 값: 재무상태는 그 분기 말 값, 손익·현금흐름은 이번 누적 − 앞 누적
        quarter = {k: v for k, v in values.items() if k in STOCK}
        prev = cum.get((year, q - 1)) if q > 1 else {}
        if prev is not None:
            quarter |= {k: v - prev[k] if q > 1 else v for k, v in values.items() if k in FLOW and (q == 1 or k in prev)}
        lines += [Line("Q", f"{year}Q{q}", k, v) for k, v in _fcf(quarter).items()]
    # 올해 누적: 사업보고서가 아직 없는 가장 최근 연도의 마지막 분기 보고서
    latest = max((k for k in cum if k[1] < 4 and (k[0], 4) not in cum), default=None)
    if latest:
        lines += [Line("C", f"{latest[0]}Q{latest[1]}", k, v) for k, v in _fcf(cum[latest]).items()]
    return lines


def dart_statements(corp_code: str, key: str, today: date, http: httpx.Client) -> list[Line]:
    """작년·올해 분기·반기·사업보고서를 받아요. 연결 재무제표가 있으면 연결, 없으면 별도."""
    for fs_div in ("CFS", "OFS"):
        reports = {}
        for year in (today.year - 1, today.year):
            for code, q in REPORTS.items():
                body = _dart_json(http, "fnlttSinglAcntAll.json", {
                    "crtfc_key": key, "corp_code": corp_code, "bsns_year": str(year), "reprt_code": code, "fs_div": fs_div,
                })
                if rows := body.get("list"):
                    reports[(year, q)] = rows
        if not any(q == 4 for _, q in reports):
            # 사업보고서(3월 말)가 아직이면 재작년 것으로 연간 값을 채워요.
            body = _dart_json(http, "fnlttSinglAcntAll.json", {
                "crtfc_key": key, "corp_code": corp_code, "bsns_year": str(today.year - 2), "reprt_code": "11011", "fs_div": fs_div,
            })
            if rows := body.get("list"):
                reports[(today.year - 2, 4)] = rows
        if reports:
            return from_dart(reports)
    return []


# 보통주 수(유통주식수 = 발행주식 − 자기주식). PER·PBR 밴드의 주당순이익·주당순자산에 써요.
SHARE_REPORTS = (("11014", 0), ("11012", 0), ("11013", 0), ("11011", 1), ("11014", 1))
SHARE_DAY = {"11013": "03-31", "11012": "06-30", "11014": "09-30", "11011": "12-31"}


def dart_shares(corp_code: str, key: str, today: date, http: httpx.Client) -> tuple[Decimal, date] | None:
    """가장 최근 보고서의 (보통주 유통주식수, 기준일)."""
    for code, back in SHARE_REPORTS:
        year = today.year - back
        body = _dart_json(http, "stockTotqySttus.json", {"crtfc_key": key, "corp_code": corp_code, "bsns_year": str(year), "reprt_code": code})
        if shares := parse_dart_shares(body.get("list") or []):
            return shares, date.fromisoformat(f"{year}-{SHARE_DAY[code]}")
    return None


def parse_dart_shares(rows: list[dict]) -> Decimal | None:
    row = next((r for r in rows if _norm(r.get("se")) == "보통주"), None) or next((r for r in rows if _norm(r.get("se")) == "합계"), None)
    if not row:
        return None
    v = _amount(row.get("distb_stock_co")) or _amount(row.get("istc_totqy"))
    return v if v and v > 0 else None


# ---------------------------------------------------------------- 미국(SEC)

SEC_ITEMS = {
    "revenue": ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"),
    "cost_of_sales": ("CostOfRevenue", "CostOfGoodsAndServicesSold"),
    "gross_profit": ("GrossProfit",),
    "operating_income": ("OperatingIncomeLoss",),
    "net_income": ("NetIncomeLoss",),
    "assets": ("Assets",),
    "cash": ("CashAndCashEquivalentsAtCarryingValue",),
    "liabilities": ("Liabilities",),
    "equity": ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "cfo": ("NetCashProvidedByUsedInOperatingActivities",),
    "cfi": ("NetCashProvidedByUsedInInvestingActivities",),
    "cff": ("NetCashProvidedByUsedInFinancingActivities",),
    "capex": ("PaymentsToAcquirePropertyPlantAndEquipment",),
}
YEAR_FRAME = re.compile(r"^CY(\d{4})$")
QUARTER_FRAME = re.compile(r"^CY(\d{4})Q([1-4])$")
INSTANT_FRAME = re.compile(r"^CY(\d{4})Q([1-4])I$")
KEEP_YEARS = 4


def _frames(facts: dict, tags: tuple[str, ...]) -> dict[str, Decimal]:
    gaap = facts.get("facts", {}).get("us-gaap", {})
    out: dict[str, Decimal] = {}
    for tag in tags:
        for f in gaap.get(tag, {}).get("units", {}).get("USD", []):
            if (frame := f.get("frame")) and frame not in out:
                out[frame] = Decimal(str(f["val"]))
    return out


def from_sec(facts: dict) -> list[Line]:
    years: dict[str, dict[str, Decimal]] = {}
    quarters: dict[str, dict[str, Decimal]] = {}
    for item, tags in SEC_ITEMS.items():
        for frame, v in _frames(facts, tags).items():
            v = abs(v) if item == "capex" else v
            if item in STOCK and (m := INSTANT_FRAME.match(frame)):
                quarters.setdefault(f"{m[1]}Q{m[2]}", {})[item] = v
                if m[2] == "4":
                    years.setdefault(m[1], {})[item] = v
            elif item in FLOW and (m := YEAR_FRAME.match(frame)):
                years.setdefault(m[1], {})[item] = v
            elif item in FLOW and (m := QUARTER_FRAME.match(frame)):
                quarters.setdefault(f"{m[1]}Q{m[2]}", {})[item] = v
    # 4분기 석 달 값은 따로 보고하지 않는 회사가 많아요: 1년 − 1~3분기
    for y, values in years.items():
        q4 = quarters.setdefault(f"{y}Q4", {})
        for item in FLOW:
            parts = [quarters.get(f"{y}Q{n}", {}).get(item) for n in (1, 2, 3)]
            if item not in q4 and item in values and all(p is not None for p in parts):
                q4[item] = values[item] - sum(parts)
    keep_y = sorted(years)[-KEEP_YEARS:]
    keep_q = sorted(p for p in quarters if quarters[p])[-8:]
    lines = [Line("Y", y, k, v) for y in keep_y for k, v in _fcf(years[y]).items()]
    lines += [Line("Q", p, k, v) for p in keep_q for k, v in _fcf(quarters[p]).items()]
    return lines


def sec_shares(facts: dict) -> tuple[Decimal, date] | None:
    """표지에 적는 보통주 수(dei:EntityCommonStockSharesOutstanding) 중 가장 최근 값."""
    rows = facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares", [])
    rows = [r for r in rows if r.get("end") and r.get("val")]
    if not rows:
        return None
    last = max(rows, key=lambda r: r["end"])
    return Decimal(str(last["val"])), date.fromisoformat(last["end"])


def sec_statements(cik: int, user_agent: str, http: httpx.Client) -> tuple[list[Line], tuple[Decimal, date] | None]:
    """(재무제표 줄, (주식 수, 기준일))"""
    res = http.get(SEC_FACTS.format(cik=cik), headers={"User-Agent": user_agent})
    res.raise_for_status()
    facts = res.json()
    return from_sec(facts), sec_shares(facts)
