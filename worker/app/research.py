"""보유 종목의 뉴스·실적·재무를 무료 API에서 가져옵니다.

국내: 구글 뉴스 RSS(키 없음) 또는 네이버 API HUB(뉴스), OpenDART(실적 공시, 재무제표)
미국: Finnhub(뉴스, 분기 EPS), SEC EDGAR(재무제표, 키 없음)
"""
import html
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime

import httpx

DART = "https://opendart.fss.or.kr/api"
# 네이버 개발자센터 검색 API는 2026-07-31 신규 신청이 끝나 네이버 클라우드 API HUB 주소를 씁니다.
NAVER_NEWS = "https://naverapihub.apigw.ntruss.com/search/v1/news"
GOOGLE_NEWS = "https://news.google.com/rss/search"
FINNHUB = "https://finnhub.io/api/v1"
SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"


@dataclass(frozen=True)
class News:
    ticker: str
    title: str
    url: str
    source: str
    published_at: datetime
    summary: str


@dataclass(frozen=True)
class Earnings:
    """실적 발표 한 건. 국내는 공시 제목·링크, 미국은 EPS 실제/예상."""
    ticker: str
    period: str
    title: str
    url: str
    reported_on: date | None
    eps_actual: Decimal | None = None
    eps_estimate: Decimal | None = None


@dataclass(frozen=True)
class Financials:
    """연간 재무. 금액은 해당 통화 원 단위 그대로(국내 원, 미국 달러)."""
    ticker: str
    period: str
    revenue: Decimal | None
    operating_income: Decimal | None
    liabilities: Decimal | None
    equity: Decimal | None
    operating_cash_flow: Decimal | None


def _amount(raw) -> Decimal | None:
    text = str(raw if raw is not None else "").replace(",", "").strip()
    if text in ("", "-"):
        return None
    return Decimal(text)


def _clean(text: str) -> str:
    # 네이버는 검색어를 <b>로 감싸고 HTML 엔티티로 보냅니다.
    return html.unescape(re.sub(r"</?b>", "", text or "")).strip()


# ---------------------------------------------------------------- 국내 뉴스

def google_news(ticker: str, name: str, http: httpx.Client) -> list[News]:
    """키 없이 쓰는 구글 뉴스 한국어 RSS. 최근 7일, 최신 10건."""
    res = http.get(GOOGLE_NEWS, params={"q": f'"{name}" when:7d', "hl": "ko", "gl": "KR", "ceid": "KR:ko"})
    res.raise_for_status()
    items = []
    for item in ET.fromstring(res.content).iter("item"):
        source = (item.findtext("source") or "").strip()
        title = (item.findtext("title") or "").strip()
        # 제목 끝에 " - 언론사"가 붙어 옵니다.
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        items.append(News(
            ticker=ticker, title=html.unescape(title), url=(item.findtext("link") or "").strip(),
            source=source or "구글 뉴스", published_at=parsedate_to_datetime(item.findtext("pubDate")), summary="",
        ))
    items.sort(key=lambda n: n.published_at, reverse=True)
    return [n for n in items if n.title and n.url][:10]


def naver_news(ticker: str, name: str, client_id: str, secret: str, http: httpx.Client) -> list[News]:
    res = http.get(
        NAVER_NEWS,
        params={"query": name, "display": "10", "sort": "date", "format": "json"},
        headers={"X-NCP-APIGW-API-KEY-ID": client_id, "X-NCP-APIGW-API-KEY": secret},
    )
    res.raise_for_status()
    return [
        News(
            ticker=ticker,
            title=_clean(item["title"]),
            url=item.get("originallink") or item["link"],
            source="네이버 뉴스",
            published_at=parsedate_to_datetime(item["pubDate"]),
            summary=_clean(item.get("description", "")),
        )
        for item in res.json().get("items", [])
    ]


# ---------------------------------------------------------------- OpenDART

def dart_corp_codes(key: str, http: httpx.Client) -> dict[str, str]:
    """상장사 종목코드(6자리) -> DART 고유번호(8자리)."""
    res = http.get(f"{DART}/corpCode.xml", params={"crtfc_key": key})
    res.raise_for_status()
    try:
        archive = zipfile.ZipFile(io.BytesIO(res.content))
    except zipfile.BadZipFile:
        # 키가 틀리면 zip 대신 오류 XML/JSON이 옵니다.
        raise RuntimeError(f"DART 고유번호 다운로드 실패: {res.text[:200]}")
    root = ET.fromstring(archive.read(archive.namelist()[0]))
    codes = {}
    for item in root.iter("list"):
        stock = (item.findtext("stock_code") or "").strip()
        if stock:
            codes[stock] = item.findtext("corp_code").strip()
    return codes


def _dart_json(http: httpx.Client, path: str, params: dict) -> dict:
    res = http.get(f"{DART}/{path}", params=params)
    res.raise_for_status()
    body = res.json()
    # 013 = 조회된 데이터가 없습니다
    if body.get("status") not in ("000", "013"):
        raise RuntimeError(f"DART 오류 {path}: {body.get('status')} {body.get('message')}")
    return body


EARNINGS_TITLE = re.compile(r"영업\(잠정\)실적|사업보고서|반기보고서|분기보고서")


# 국내는 실적 발표일을 미리 알려 주는 무료 달력이 없어서, 회사가 미리 내는 '기업설명회(IR) 개최 안내' 공시를 읽습니다.
# IR 목적에 '실적'이 들어 있고 개최일이 앞으로인 것만 실적 발표일로 씁니다. IR 공시를 안 내는 회사는 알 수 없어요.
IR_TITLE = re.compile(r"기업설명회\s*\(IR\)\s*개최")
IR_DATE = re.compile(r"(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})")
IR_TIME = re.compile(r"(\d{1,2})\s*:\s*(\d{2})")


def parse_ir_notice(text: str) -> tuple[date, str] | None:
    """IR 개최 안내 본문에서 (개최일, 시각)을 찾습니다. 실적 설명회가 아니면 None."""
    plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text)))
    if "실적" not in plain:
        return None
    at = re.search(r"(개최\s*일시|일\s*시|일\s*자)", plain)
    window = plain[at.end():at.end() + 120] if at else plain
    m = IR_DATE.search(window)
    if not m:
        return None
    try:
        day = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    t = IR_TIME.search(window[m.end():m.end() + 40])
    return day, f"{int(t.group(1)):02d}:{t.group(2)}" if t else ""


def dart_document_text(rcept_no: str, key: str, http: httpx.Client) -> str:
    res = http.get(f"{DART}/document.xml", params={"crtfc_key": key, "rcept_no": rcept_no})
    res.raise_for_status()
    try:
        archive = zipfile.ZipFile(io.BytesIO(res.content))
    except zipfile.BadZipFile:
        raise RuntimeError(f"DART 공시 원문 다운로드 실패: {res.text[:200]}")
    out = []
    for name in archive.namelist():
        raw = archive.read(name)
        for enc in ("utf-8", "euc-kr"):
            try:
                out.append(raw.decode(enc))
                break
            except UnicodeDecodeError:
                continue
    return "\n".join(out)


def dart_ir_earnings(ticker: str, name: str, corp_code: str, key: str, today: date, http: httpx.Client,
                     seen: dict[str, tuple[date, str] | None]) -> list:
    """앞으로 열릴 실적 IR을 일정(calendar.Event)으로. seen은 이미 읽은 공시 원문의 결과(접수번호별)라 다시 받지 않습니다."""
    from .calendar import Event

    body = _dart_json(http, "list.json", {
        "crtfc_key": key, "corp_code": corp_code, "bgn_de": (today - timedelta(days=60)).strftime("%Y%m%d"),
        "end_de": today.strftime("%Y%m%d"), "pblntf_ty": "I", "page_count": "100",
    })
    out = []
    for row in body.get("list", []):
        if not IR_TITLE.search(row.get("report_nm", "")):
            continue
        no = row["rcept_no"]
        if no not in seen:
            seen[no] = parse_ir_notice(dart_document_text(no, key, http))
        found = seen[no]
        if found and found[0] >= today:
            detail = " · ".join(p for p in ("기업설명회(IR)", found[1]) if p)
            out.append(Event(found[0], "earnings", "KR", ticker, f"{name} 실적 발표", detail))
    return sorted(set(out), key=lambda e: e.day)


def dart_earnings(ticker: str, corp_code: str, key: str, today: date, http: httpx.Client) -> list[Earnings]:
    body = _dart_json(http, "list.json", {
        "crtfc_key": key, "corp_code": corp_code, "bgn_de": (today - timedelta(days=365)).strftime("%Y%m%d"),
        "end_de": today.strftime("%Y%m%d"), "page_count": "100",
    })
    out = []
    for row in body.get("list", []):
        title = row["report_nm"].strip()
        if not EARNINGS_TITLE.search(title):
            continue
        period = m.group(1) if (m := re.search(r"\((\d{4}\.\d{2})\)", title)) else ""
        out.append(Earnings(
            ticker=ticker, period=period, title=title,
            url=f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={row['rcept_no']}",
            reported_on=datetime.strptime(row["rcept_dt"], "%Y%m%d").date(),
        ))
    return out


# 표준 계정 ID가 없는 회사도 있어 계정명으로 한 번 더 찾습니다.
DART_ACCOUNTS = {
    "revenue": (("ifrs-full_Revenue",), ("매출액", "영업수익", "수익(매출액)", "매출")),
    "operating_income": (("dart_OperatingIncomeLoss",), ("영업이익", "영업이익(손실)")),
    "liabilities": (("ifrs-full_Liabilities",), ("부채총계",)),
    "equity": (("ifrs-full_Equity",), ("자본총계",)),
    "operating_cash_flow": (("ifrs-full_CashFlowsFromUsedInOperatingActivities",), ("영업활동현금흐름", "영업활동으로인한현금흐름")),
}


def parse_dart_financials(ticker: str, year: int, rows: list[dict]) -> list[Financials]:
    """사업보고서 한 건에는 당기·전기·전전기 금액이 같이 들어 있습니다."""
    def find(field: str, column: str) -> Decimal | None:
        ids, names = DART_ACCOUNTS[field]
        for row in rows:
            if row.get("account_id") in ids:
                return _amount(row.get(column))
        for row in rows:
            if re.sub(r"\s", "", row.get("account_nm", "")) in names:
                return _amount(row.get(column))
        return None

    out = []
    for offset, column in enumerate(("thstrm_amount", "frmtrm_amount", "bfefrmtrm_amount")):
        values = {field: find(field, column) for field in DART_ACCOUNTS}
        if any(v is not None for v in values.values()):
            out.append(Financials(ticker=ticker, period=str(year - offset), **values))
    return out


def dart_financials(ticker: str, corp_code: str, key: str, today: date, http: httpx.Client) -> list[Financials]:
    # 사업보고서는 3월 말에 나오므로 작년 것이 없으면 재작년 것을 씁니다. 연결 우선, 없으면 별도.
    for year in (today.year - 1, today.year - 2):
        for fs_div in ("CFS", "OFS"):
            body = _dart_json(http, "fnlttSinglAcntAll.json", {
                "crtfc_key": key, "corp_code": corp_code, "bsns_year": str(year), "reprt_code": "11011", "fs_div": fs_div,
            })
            if rows := body.get("list"):
                return parse_dart_financials(ticker, year, rows)
    return []


# ---------------------------------------------------------------- Finnhub

def finnhub_news(ticker: str, key: str, today: date, http: httpx.Client) -> list[News]:
    res = http.get(f"{FINNHUB}/company-news", params={
        "symbol": ticker, "from": (today - timedelta(days=14)).isoformat(), "to": today.isoformat(), "token": key,
    })
    res.raise_for_status()
    items = sorted(res.json(), key=lambda i: i.get("datetime", 0), reverse=True)[:10]
    return [
        News(
            ticker=ticker, title=i["headline"].strip(), url=i["url"], source=i.get("source") or "Finnhub",
            published_at=datetime.fromtimestamp(i["datetime"], tz=timezone.utc), summary=(i.get("summary") or "").strip(),
        )
        for i in items if i.get("headline") and i.get("url")
    ]


def finnhub_earnings(ticker: str, key: str, http: httpx.Client) -> list[Earnings]:
    res = http.get(f"{FINNHUB}/stock/earnings", params={"symbol": ticker, "token": key})
    res.raise_for_status()
    out = []
    for e in res.json():
        out.append(Earnings(
            ticker=ticker, period=e["period"], title=f"{e['year']}년 {e['quarter']}분기 실적",
            url=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={ticker}&type=10-Q", reported_on=None,
            eps_actual=_amount(e.get("actual")), eps_estimate=_amount(e.get("estimate")),
        ))
    return out


# ---------------------------------------------------------------- SEC EDGAR

def sec_ciks(user_agent: str, http: httpx.Client) -> dict[str, int]:
    res = http.get(SEC_TICKERS, headers={"User-Agent": user_agent})
    res.raise_for_status()
    return {row["ticker"].upper(): int(row["cik_str"]) for row in res.json().values()}


SEC_TAGS = {
    "revenue": ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"),
    "operating_income": ("OperatingIncomeLoss",),
    "liabilities": ("Liabilities",),
    "equity": ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
}


IFRS_TAGS = {
    "revenue": ("Revenue", "RevenueFromContractsWithCustomers"),
    "operating_income": ("ProfitLossFromOperatingActivities",),
    "liabilities": ("Liabilities",),
    "equity": ("EquityAttributableToOwnersOfParent", "Equity"),
    "operating_cash_flow": ("CashFlowsFromUsedInOperatingActivities",),
}
ANNUAL_FORMS = ("10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A")
ER_API = "https://open.er-api.com/v6/latest/USD"


def sec_book(facts: dict) -> tuple[dict, str, bool]:
    """(태그 묶음, 통화, IFRS인가). 미국 회사는 us-gaap·달러, 노키아처럼 20-F를 내는 외국 회사는 ifrs-full에
    자기 나라 돈(유로 등)으로 적어요. 그 회사가 가장 많이 쓴 통화를 골라요."""
    all_facts = facts.get("facts", {})
    gaap = all_facts.get("us-gaap", {})
    if any("USD" in gaap.get(t, {}).get("units", {}) for tags in (SEC_TAGS["revenue"], SEC_TAGS["operating_income"]) for t in tags):
        return gaap, "USD", False
    ifrs = all_facts.get("ifrs-full", {})
    count: dict[str, int] = {}
    for tag in IFRS_TAGS["revenue"] + IFRS_TAGS["operating_income"]:
        for unit, rows in ifrs.get(tag, {}).get("units", {}).items():
            if re.fullmatch(r"[A-Z]{3}", unit):
                count[unit] = count.get(unit, 0) + len(rows)
    if not count:
        return gaap, "USD", False
    return ifrs, max(count, key=count.get), True


def usd_rate(currency: str, http: httpx.Client) -> Decimal:
    """1 (통화) = 몇 달러. 외국 회사 재무제표를 달러로 바꿔 미국 회사와 나란히 비교하려고 써요(오늘 환율 하나로)."""
    if currency == "USD":
        return Decimal(1)
    res = http.get(ER_API)
    res.raise_for_status()
    per_usd = res.json().get("rates", {}).get(currency)
    if not per_usd:
        raise ValueError(f"{currency} 환율을 못 받았어요")
    return Decimal(1) / Decimal(str(per_usd))


def current_first(gaap: dict, tags: tuple[str, ...], unit: str = "USD") -> list[str]:
    """요즘 보고에 쓰는 태그를 앞에 둬요. 겹치는 기간은 앞 태그 값을 쓰니까, 예전 태그에 잘못 적힌 값
    (예: 아이온큐 2022년 Revenues가 1,113만 달러가 아니라 12억 3,500만 달러로 적힘)이 섞이지 않게 해요.
    가장 최근 기간(end)이 같으면 원래 순서대로."""
    def latest(tag: str) -> str:
        return max((f.get("end", "") for f in gaap.get(tag, {}).get("units", {}).get(unit, [])), default="")
    return sorted(tags, key=lambda t: (latest(t), -tags.index(t)), reverse=True)


def _annual(book: dict, unit: str, tags: tuple[str, ...]) -> dict[str, Decimal]:
    """10-K(외국 회사는 20-F)에 보고된 연간 값을 회계연도 말일(end)별로 모읍니다. 같은 값이 여러 보고서에 반복되면 나중 것을 씁니다.

    회사가 해마다 다른 태그로 보고하기도 해서(예: 예전엔 Revenues, 요즘은 RevenueFromContract...)
    모든 태그를 합치고, 같은 연도가 겹치면 요즘 쓰는 태그 값을 씁니다.
    """
    merged: dict[str, Decimal] = {}
    for tag in current_first(book, tags, unit):
        units = book.get(tag, {}).get("units", {}).get(unit)
        if not units:
            continue
        by_end: dict[str, Decimal] = {}
        for f in sorted(units, key=lambda f: f.get("filed", "")):
            if f.get("form") not in ANNUAL_FORMS or f.get("fp") != "FY":
                continue
            if "start" in f:
                # 손익·현금흐름은 1년짜리 기간만 씁니다(분기 누적 값 제외).
                days = (date.fromisoformat(f["end"]) - date.fromisoformat(f["start"])).days
                if not 350 <= days <= 380:
                    continue
            by_end[f["end"]] = Decimal(str(f["val"]))
        merged = by_end | merged
    return merged


def parse_sec_financials(ticker: str, facts: dict, rate: Decimal = Decimal(1)) -> list[Financials]:
    """rate: 그 회사 통화 1 = 몇 달러 (미국 회사는 1)"""
    book, unit, ifrs = sec_book(facts)
    names = IFRS_TAGS if ifrs else SEC_TAGS
    series = {field: {end: (v * rate).quantize(Decimal("0.01")) for end, v in _annual(book, unit, names[field]).items()} for field in SEC_TAGS}
    ends = sorted(set(series["revenue"]) | set(series["operating_income"]), reverse=True)[:3]
    return [
        Financials(ticker=ticker, period=f"FY{end[:4]}", **{field: values.get(end) for field, values in series.items()})
        for end in ends
    ]


def sec_facts(cik: int, user_agent: str, http: httpx.Client) -> tuple[dict, Decimal]:
    """(SEC 재무 자료, 달러 환율)"""
    res = http.get(SEC_FACTS.format(cik=cik), headers={"User-Agent": user_agent})
    res.raise_for_status()
    facts = res.json()
    return facts, usd_rate(sec_book(facts)[1], http)


def sec_financials(ticker: str, cik: int, user_agent: str, http: httpx.Client) -> list[Financials]:
    facts, rate = sec_facts(cik, user_agent, http)
    return parse_sec_financials(ticker, facts, rate)
