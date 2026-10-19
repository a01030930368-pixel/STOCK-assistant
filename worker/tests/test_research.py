import io
import zipfile
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app import research


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_google_news_parses_rss():
    rss = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
      <item><title>삼성전자, 3분기 &amp; 실적 - 한국경제</title><link>https://news.google.com/rss/articles/a</link>
        <pubDate>Sun, 18 Oct 2026 23:00:00 GMT</pubDate><source url="https://www.hankyung.com">한국경제</source></item>
      <item><title>새 소식 - 연합뉴스</title><link>https://news.google.com/rss/articles/b</link>
        <pubDate>Mon, 19 Oct 2026 01:00:00 GMT</pubDate><source url="https://www.yna.co.kr">연합뉴스</source></item>
    </channel></rss>"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["q"] == '"삼성전자" when:7d'
        assert request.url.params["hl"] == "ko"
        return httpx.Response(200, content=rss.encode())

    news = research.google_news("005930", "삼성전자", client(handler))
    assert [n.title for n in news] == ["새 소식", "삼성전자, 3분기 & 실적"]
    assert news[1].source == "한국경제"
    assert news[1].url == "https://news.google.com/rss/articles/a"


def test_naver_news_strips_markup():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "naverapihub.apigw.ntruss.com"
        assert request.headers["X-NCP-APIGW-API-KEY-ID"] == "id"
        assert request.url.params["query"] == "삼성전자"
        return httpx.Response(200, json={"items": [{
            "title": "<b>삼성전자</b>, 3분기 &quot;깜짝&quot; 실적", "originallink": "https://news.example/1",
            "link": "https://n.news.naver.com/1", "description": "영업이익 <b>12조</b>",
            "pubDate": "Mon, 19 Oct 2026 08:30:00 +0900",
        }]})

    [n] = research.naver_news("005930", "삼성전자", "id", "secret", client(handler))
    assert n.title == '삼성전자, 3분기 "깜짝" 실적'
    assert n.url == "https://news.example/1"
    assert n.summary == "영업이익 12조"
    assert n.published_at.isoformat() == "2026-10-19T08:30:00+09:00"


def test_dart_corp_codes_reads_zip():
    xml = """<?xml version="1.0" encoding="UTF-8"?><result>
      <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list>
      <list><corp_code>00999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list>
    </result>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("CORPCODE.xml", xml)

    codes = research.dart_corp_codes("KEY", client(lambda r: httpx.Response(200, content=buf.getvalue())))
    assert codes == {"005930": "00126380"}


def test_dart_corp_codes_reports_bad_key():
    with pytest.raises(RuntimeError, match="DART"):
        research.dart_corp_codes("BAD", client(lambda r: httpx.Response(200, json={"status": "010", "message": "등록되지 않은 키"})))


def test_dart_earnings_keeps_results_and_reports():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "000", "list": [
            {"report_nm": "연결재무제표기준영업(잠정)실적(공정공시)", "rcept_no": "20261008000123", "rcept_dt": "20261008"},
            {"report_nm": "분기보고서 (2026.06)", "rcept_no": "20260814000456", "rcept_dt": "20260814"},
            {"report_nm": "임원ㆍ주요주주특정증권등소유상황보고서", "rcept_no": "1", "rcept_dt": "20261001"},
        ]})

    items = research.dart_earnings("005930", "00126380", "KEY", date(2026, 10, 19), client(handler))
    assert [e.title for e in items] == ["연결재무제표기준영업(잠정)실적(공정공시)", "분기보고서 (2026.06)"]
    assert items[0].url == "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261008000123"
    assert items[1].period == "2026.06"
    assert items[0].reported_on == date(2026, 10, 8)


DART_ROWS = [
    {"sj_div": "IS", "account_id": "ifrs-full_Revenue", "account_nm": "매출액", "thstrm_amount": "300,000", "frmtrm_amount": "250000", "bfefrmtrm_amount": "200000"},
    {"sj_div": "IS", "account_id": "dart_OperatingIncomeLoss", "account_nm": "영업이익", "thstrm_amount": "30000", "frmtrm_amount": "-5000", "bfefrmtrm_amount": ""},
    {"sj_div": "BS", "account_id": "-표준계정코드 미사용-", "account_nm": "부채 총계", "thstrm_amount": "100000", "frmtrm_amount": "90000", "bfefrmtrm_amount": "80000"},
    {"sj_div": "BS", "account_id": "ifrs-full_Equity", "account_nm": "자본총계", "thstrm_amount": "200000", "frmtrm_amount": "180000", "bfefrmtrm_amount": "160000"},
    {"sj_div": "CF", "account_id": "ifrs-full_CashFlowsFromUsedInOperatingActivities", "account_nm": "영업활동현금흐름", "thstrm_amount": "40000", "frmtrm_amount": "20000", "bfefrmtrm_amount": "10000"},
]


def test_parse_dart_financials_three_years_with_name_fallback():
    rows = research.parse_dart_financials("005930", 2025, DART_ROWS)
    assert [f.period for f in rows] == ["2025", "2024", "2023"]
    assert rows[0].revenue == Decimal(300000)
    assert rows[0].liabilities == Decimal(100000)  # 계정명 '부채 총계'로 찾음
    assert rows[1].operating_income == Decimal(-5000)
    assert rows[2].operating_income is None


def test_dart_financials_falls_back_to_previous_year_and_separate():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.url.params["bsns_year"], request.url.params["fs_div"]))
        if calls[-1] == ("2024", "OFS"):
            return httpx.Response(200, json={"status": "000", "list": DART_ROWS})
        return httpx.Response(200, json={"status": "013", "message": "조회된 데이터가 없습니다."})

    rows = research.dart_financials("000000", "1", "KEY", date(2026, 2, 1), client(handler))
    assert calls == [("2025", "CFS"), ("2025", "OFS"), ("2024", "CFS"), ("2024", "OFS")]
    assert rows[0].period == "2024"


def test_finnhub_news_and_earnings():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("company-news"):
            return httpx.Response(200, json=[
                {"headline": "Old", "url": "https://x/1", "source": "Reuters", "datetime": 1760000000, "summary": ""},
                {"headline": "New", "url": "https://x/2", "source": "CNBC", "datetime": 1760800000, "summary": "s"},
            ])
        return httpx.Response(200, json=[{"actual": 1.64, "estimate": 1.6, "period": "2026-06-30", "quarter": 3, "year": 2026, "symbol": "AAPL"}])

    news = research.finnhub_news("AAPL", "KEY", date(2026, 10, 19), client(handler))
    assert [n.title for n in news] == ["New", "Old"]
    [e] = research.finnhub_earnings("AAPL", "KEY", client(handler))
    assert e.eps_actual == Decimal("1.64") and e.eps_estimate == Decimal("1.6") and e.period == "2026-06-30"


def fact(val, end, start=None, form="10-K", fp="FY", filed="2025-11-01"):
    f = {"val": val, "end": end, "form": form, "fp": fp, "filed": filed}
    if start:
        f["start"] = start
    return f


SEC_FACTS = {"facts": {"us-gaap": {
    "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
        fact(390, "2024-09-28", "2023-10-01", filed="2024-11-01"),
        fact(416, "2025-09-27", "2024-09-29"),
        fact(100, "2025-06-28", "2025-03-30", form="10-Q", fp="Q3"),  # 분기 값은 제외
        fact(95, "2025-09-27", "2025-06-29"),  # 10-K 안의 4분기 값도 제외(기간 3개월)
    ]}},
    "OperatingIncomeLoss": {"units": {"USD": [fact(123, "2024-09-28", "2023-10-01"), fact(133, "2025-09-27", "2024-09-29")]}},
    "Liabilities": {"units": {"USD": [fact(308, "2024-09-28"), fact(285, "2025-09-27")]}},
    "StockholdersEquity": {"units": {"USD": [fact(57, "2024-09-28"), fact(74, "2025-09-27")]}},
    "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [fact(118, "2024-09-28", "2023-10-01"), fact(111, "2025-09-27", "2024-09-29")]}},
}}}


def test_parse_sec_financials_uses_annual_10k_values():
    rows = research.parse_sec_financials("AAPL", SEC_FACTS)
    assert [r.period for r in rows] == ["FY2025", "FY2024"]
    assert rows[0].revenue == Decimal(416)
    assert rows[0].operating_income == Decimal(133)
    assert rows[0].liabilities == Decimal(285) and rows[0].equity == Decimal(74)
    assert rows[1].operating_cash_flow == Decimal(118)


def test_sec_requests_send_user_agent():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "me@example.com" in request.headers["User-Agent"]
        return httpx.Response(200, json={"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}})

    assert research.sec_ciks("STOCK-assistant me@example.com", client(handler)) == {"AAPL": 320193}
