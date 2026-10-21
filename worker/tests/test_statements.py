from decimal import Decimal as D

from app import statements
from app.statements import Line, from_dart, from_sec


def row(div, aid, name, th, add=None, fr=None, bf=None):
    return {"sj_div": div, "account_id": aid, "account_nm": name, "thstrm_amount": th, "thstrm_add_amount": add or "",
            "frmtrm_amount": fr or "", "bfefrmtrm_amount": bf or ""}


def report(rev, rev_add, cfo, assets, op=None, fr=None):
    rows = [row("IS", "ifrs-full_Revenue", "매출액", rev, rev_add, *(fr or [None, None])),
            row("CF", "ifrs-full_CashFlowsFromUsedInOperatingActivities", "영업활동현금흐름", cfo),
            row("CF", "-표준계정코드 미사용-", "유형자산의 취득", "-30"),
            row("BS", "ifrs-full_Assets", "자산 총계", assets),
            row("SCE", "-", "당기순이익", "999")]  # 자본변동표의 순이익은 무시
    if op:
        rows.append(row("IS", "dart_OperatingIncomeLoss", "영업이익", op))
    return rows


def pick(lines, kind, period, item):
    return next((x.value for x in lines if (x.kind, x.period, x.item) == (kind, period, item)), None)


def test_dart_quarters_from_cumulative_reports():
    lines = from_dart({
        (2025, 1): report("100", "100", "40", "1000"),
        (2025, 2): report("120", "220", "90", "1100"),
        (2025, 3): report("130", "350", "150", "1200"),
        (2025, 4): report("500", None, "200", "1300", fr=["400", "300"]),
        (2026, 1): report("140", "140", "50", "1400"),
    })
    assert [pick(lines, "Q", f"2025Q{q}", "revenue") for q in (1, 2, 3, 4)] == [D(100), D(120), D(130), D(150)]
    assert pick(lines, "Q", "2025Q2", "cfo") == D(50)  # 현금흐름은 누적이라 앞 보고서를 빼요
    assert pick(lines, "Q", "2025Q3", "assets") == D(1200)
    assert pick(lines, "Y", "2025", "fcf") == D(170)  # 영업현금 200 − 설비투자 30
    assert (pick(lines, "Y", "2024", "revenue"), pick(lines, "Y", "2023", "revenue")) == (D(400), D(300))
    assert pick(lines, "Q", "2024Q4", "assets") is None  # 분기 보고서가 없는 해는 연간만
    assert pick(lines, "C", "2026Q1", "revenue") == D(140)
    assert pick(lines, "Y", "2025", "net_income") is None


def fact(frame, val, form="10-Q"):
    return {"frame": frame, "val": val, "form": form}


def test_sec_frames_and_derived_q4():
    facts = {"facts": {"us-gaap": {
        "Revenues": {"units": {"USD": [fact("CY2024", 100, "10-K"), fact("CY2024Q1", 20), fact("CY2024Q2", 25), fact("CY2024Q3", 25)]}},
        "Assets": {"units": {"USD": [fact("CY2024Q3I", 500), fact("CY2024Q4I", 600, "10-K")]}},
        "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [fact("CY2024", 40, "10-K")]}},
        "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": [fact("CY2024", 15, "10-K")]}},
    }}}
    lines = from_sec(facts)
    assert pick(lines, "Q", "2024Q4", "revenue") == D(30)
    assert pick(lines, "Y", "2024", "assets") == D(600)
    assert pick(lines, "Y", "2024", "fcf") == D(25)
    assert Line("Q", "2024Q3", "assets", D(500)) in lines


def test_shares_from_dart_and_sec():
    from datetime import date
    from decimal import Decimal
    rows = [{"se": "보통주", "istc_totqy": "728,002,365", "tesstk_co": "8,000,000", "distb_stock_co": "720,002,365"},
            {"se": "합계", "istc_totqy": "728,002,365", "distb_stock_co": "720,002,365"}]
    assert statements.parse_dart_shares(rows) == Decimal("720002365")
    assert statements.parse_dart_shares([]) is None
    facts = {"facts": {"dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": [
        {"end": "2026-04-30", "val": 24300000000}, {"end": "2026-08-20", "val": 24400000000}]}}}}}
    assert statements.sec_shares(facts) == (Decimal("24400000000"), date(2026, 8, 20))
