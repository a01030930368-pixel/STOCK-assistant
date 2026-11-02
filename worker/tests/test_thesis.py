from datetime import date

import pytest

from app import thesis
from app.thesis import Item


def test_kr_filings_keeps_preliminary_and_reports_once_per_quarter():
    rows = [
        {"rcept_no": "1", "rcept_dt": "20261023", "report_nm": "연결재무제표기준영업(잠정)실적(공정공시)"},
        {"rcept_no": "2", "rcept_dt": "20261024", "report_nm": "[기재정정]연결재무제표기준영업(잠정)실적(공정공시)"},
        {"rcept_no": "3", "rcept_dt": "20261114", "report_nm": "분기보고서 (2026.09)"},
        {"rcept_no": "4", "rcept_dt": "20260814", "report_nm": "반기보고서 (2026.06)"},
        {"rcept_no": "5", "rcept_dt": "20260310", "report_nm": "사업보고서 (2025.12)"},
        {"rcept_no": "6", "rcept_dt": "20260310", "report_nm": "주요사항보고서(자기주식취득결정)"},
        {"rcept_no": "7", "rcept_dt": "20260115", "report_nm": "분기보고서 (2025.11)"},
    ]
    got = {(f.period, f.source): f for f in thesis.kr_filings("000660", rows)}
    assert set(got) == {("2026Q3", "dart_prelim"), ("2026Q3", "dart_report"), ("2026Q2", "dart_report"), ("2025Q4", "dart_report")}
    assert got[("2026Q3", "dart_prelim")].url.endswith("rcpNo=1")
    assert got[("2025Q4", "dart_report")].day == date(2026, 3, 10)


def test_sec_filings_reads_earnings_8k_and_quarterly_reports():
    body = {"filings": {"recent": {
        "form": ["8-K", "10-Q", "8-K", "10-K", "4"],
        "filingDate": ["2026-10-29", "2026-10-30", "2026-09-01", "2026-02-20", "2026-10-01"],
        "reportDate": ["2026-10-29", "2026-09-30", "2026-09-01", "2025-12-31", ""],
        "accessionNumber": ["0001-26-000001", "0001-26-000002", "0001-26-000003", "0001-26-000004", "0001-26-000005"],
        "items": ["2.02,9.01", "", "5.02", "", ""],
    }}}
    got = thesis.sec_filings("MSFT", 789019, body, date(2023, 11, 1))
    assert [(f.source, f.period) for f in got] == [("sec_8k", "2026Q3"), ("sec_10q", "2026Q3"), ("sec_10k", "2025Q4")]
    assert got[0].url == "https://www.sec.gov/Archives/edgar/data/789019/000126000001/0001-26-000001-index.htm"
    assert thesis.sec_filings("MSFT", 1, body, date(2026, 10, 1))[0].day == date(2026, 10, 29)


def test_quarter_numbers_fill_missing_quarters_from_preliminary_results():
    stmts = [("2025Q3", "revenue", 100), ("2025Q3", "operating_income", 30), ("2026Q2", "revenue", 120), ("2026Q2", "operating_income", 40)]
    reps = [("2026Q3", {"lines": {"revenue": {"cur": 150, "yoy": 101}, "operating_income": {"cur": 60, "yoy": 31}}})]
    q = thesis.quarter_numbers(stmts, reps)
    assert q["2026Q3"] == {"revenue": 150, "operating_income": 60}
    assert q["2025Q3"]["revenue"] == 100  # 재무제표 값이 우선
    assert thesis.metric_value("opm", q, "2026Q3") == pytest.approx(40)
    assert thesis.metric_value("rev_yoy", q, "2026Q3") == pytest.approx(50)
    assert thesis.metric_value("op_yoy", q, "2026Q3") == pytest.approx(100)
    assert thesis.metric_value("gpm", q, "2026Q3") is None
    assert thesis.metric_value("rev_yoy", q, "2026Q2") is None


def test_metric_line_and_judge():
    assert thesis.judge(">=", 30, 30) and not thesis.judge("<=", 31, 30)
    assert thesis.metric_line("opm", "2026Q3", 47.04, ">=", 30) == "26년 3분기 영업이익률 47.0% (기준 30% 이상) ✓"
    assert thesis.metric_line("debt", "2026Q3", 80, "<=", 60).endswith("(기준 60% 이하) ✗")


ITEMS = [Item("d:1", date(2026, 10, 29), "[뉴스] 삼성 HBM4 퀄 통과", "u1"), Item("n:abc", date(2026, 10, 23), "[실적] 3분기", "u2")]


def test_scan_prompt_numbers_items():
    p = thesis.scan_prompt("SK하이닉스", [(3, "삼성은 HBM4 인증을 못 받는다", "공급 뉴스가 없을 것")], ITEMS)
    assert "- 3. 삼성은 HBM4 인증을 못 받는다 (확인 기준: 공급 뉴스가 없을 것)" in p
    assert "- i1. [2026-10-29] [뉴스] 삼성 HBM4 퀄 통과" in p


def test_parse_scan_drops_unknown_and_keeps_verdicts_only_for_linked():
    text = """```json
    {"links": [{"thesis": 3, "item": "i1", "sign": "down", "note": "보도가 사실이면 틀려요"},
               {"thesis": 3, "item": "I1", "sign": "down"}, {"thesis": 9, "item": "i2", "sign": "up"},
               {"thesis": "4", "item": "i2", "sign": "maybe"}, {"thesis": 3, "item": "i7"}],
     "verdicts": [{"thesis": 3, "status": "bad", "why": "보도예요"}, {"thesis": 5, "status": "ok"}, {"thesis": 4, "status": "nope"}]}
    ```"""
    links, verdicts = thesis.parse_scan(text, {3, 4, 5}, ITEMS)
    assert [(l["thesis"], l["item"].ref, l["sign"]) for l in links] == [(3, "d:1", "down"), (4, "n:abc", "neutral")]
    assert verdicts == {3: {"status": "bad", "why": "보도예요"}}
    assert ITEMS[0].kind == "disclosure" and ITEMS[1].kind == "news"


def test_texts():
    assert "확인할 가설 2개" in thesis.review_text("SK하이닉스", "2026Q3", ["a", "b"])
    assert thesis.review_text("SK하이닉스", "2026Q3", []).startswith("📒 SK하이닉스 26년 3분기 실적이 나왔어요")
    assert "숫자가 기준을 못 넘었어요" in thesis.bad_text("A", "t", "w", "metric")
    assert "(11.02)" in thesis.due_text([("A", "t", date(2026, 11, 2))])
    assert thesis.news_ref("https://x") == thesis.news_ref("https://x") != thesis.news_ref("https://y")


def test_report_text():
    data = {"lines": {"revenue": {"cur": 2.4e13, "yoy": 1.8e13}, "operating_income": {"cur": 1.1e13, "yoy": None}}}
    t = thesis.report_text("2026Q3", "KR", data, "HBM이 늘었어요")
    assert t.startswith("26년 3분기 실적: 매출 ") and "1년 전 대비" in t and t.endswith("— HBM이 늘었어요")
