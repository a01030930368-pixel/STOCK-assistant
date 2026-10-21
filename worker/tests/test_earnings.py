from datetime import date

from app import earnings

# DART 잠정실적 공시 본문 모양(머리글 두 줄, 항목마다 당해·누계 두 줄)
DOC = """<DOCUMENT><BODY>
<P>연결재무제표기준영업(잠정)실적(공정공시)</P>
<TABLE><TBODY>
<TR><TD COLSPAN="2">1. 연결실적내용</TD><TD>당기실적</TD><TD>전기실적</TD><TD>전기대비증감율(%)</TD><TD>전년동기실적</TD><TD>전년동기대비증감율(%)</TD></TR>
<TR><TD COLSPAN="2">구분(단위 : 억원, %)</TD><TD>('26.3Q)</TD><TD>('26.2Q)</TD><TD></TD><TD>('25.3Q)</TD><TD></TD></TR>
<TR><TD ROWSPAN="2">매출액</TD><TD>당해실적</TD><TE>291,000</TE><TE>264,000</TE><TE>10.2</TE><TE>244,000</TE><TE>19.3</TE></TR>
<TR><TD>누계실적</TD><TE>791,000</TE><TE>500,000</TE><TE>-</TE><TE>700,000</TE><TE>13.0</TE></TR>
<TR><TD ROWSPAN="2">영업이익</TD><TD>당해실적</TD><TE>123,000</TE><TE>116,000</TE><TE>6.0</TE><TE>114,000</TE><TE>7.9</TE></TR>
<TR><TD>누계실적</TD><TE>348,000</TE><TE>225,000</TE><TE>-</TE><TE>300,000</TE><TE>16.0</TE></TR>
<TR><TD ROWSPAN="2">법인세비용차감전계속사업이익</TD><TD>당해실적</TD><TE>1</TE><TE>2</TE><TE>3</TE><TE>4</TE><TE>5</TE></TR>
<TR><TD>누계실적</TD><TE>1</TE><TE>2</TE><TE>3</TE><TE>4</TE><TE>5</TE></TR>
<TR><TD ROWSPAN="2">당기순이익</TD><TD>당해실적</TD><TE>△1,200</TE><TE>94,000</TE><TE>적자전환</TE><TE>87,500</TE><TE>적자전환</TE></TR>
<TR><TD>누계실적</TD><TE>1</TE><TE>2</TE><TE>3</TE><TE>4</TE><TE>5</TE></TR>
<TR><TD ROWSPAN="2">지배기업 소유주지분 순이익</TD><TD>당해실적</TD><TE>7</TE><TE>8</TE><TE>9</TE><TE>10</TE><TE>11</TE></TR>
</TBODY></TABLE></BODY></DOCUMENT>"""


def test_parse_preliminary_reads_this_quarter_previous_and_year_ago():
    period, lines = earnings.parse_preliminary(DOC, date(2026, 10, 21))
    assert period == "2026Q3"  # 머리글 둘째 줄에 있어도 공시일로 3분기
    assert lines["revenue"] == {"cur": 291_000e8, "prev": 264_000e8, "yoy": 244_000e8}
    assert lines["operating_income"]["yoy"] == 114_000e8
    assert lines["net_income"]["cur"] == -1_200e8  # △는 음수, 지배기업 순이익으로 덮어쓰지 않아요


def test_parse_preliminary_needs_unit():
    assert earnings.parse_preliminary(DOC.replace("단위 : 억원", ""), date(2026, 10, 21)) is None


def test_kr_period_from_date():
    assert earnings.kr_period(date(2026, 1, 28)) == "2025Q4"
    assert earnings.kr_period(date(2026, 4, 7)) == "2026Q1"


def test_kr_message_has_changes_bars_and_ai():
    period, lines = earnings.parse_preliminary(DOC, date(2026, 10, 21))
    quarters = {"2025Q3": {"revenue": 24.4e12, "operating_income": 11.4e12}, "2025Q4": {"revenue": 26.1e12},
                "2026Q1": {"revenue": 23.6e12}, "2026Q2": {"revenue": 26.4e12}, "2026Q3": {"revenue": 1.0}}
    cur = {"revenue": lines["revenue"]["cur"], "operating_income": lines["operating_income"]["cur"]}
    history = earnings.kr_history(period, cur, quarters)
    assert [h["period"] for h in history] == ["2025Q3", "2025Q4", "2026Q1", "2026Q2", "2026Q3"]
    r = earnings.Report("KR:1", "000660", "SK하이닉스", "KR", period, date(2026, 10, 21), "https://dart", lines, history=history)
    text = earnings.message(r, "HBM 매출이 늘었어요.", held=False)
    assert "📊 SK하이닉스 3분기 실적 (잠정) · ⭐ 관심종목" in text
    assert "매출 29.1조\n1년 전보다 🔴+19% · 지난 분기보다 🔴+10%" in text
    assert "순이익 −1,200억\n1년 전보다 🔵적자 전환" in text
    assert "🟨" * 10 + " 29.1조 · 26.3Q" in text
    assert "⬜" * 8 + " 24.4조 · 25.3Q" in text
    assert "영업이익률 42% (1년 전 47%)" in text
    assert "🤖 HBM 매출이 늘었어요." in text


def test_us_report_compares_estimates_and_year_ago():
    entries = [
        {"date": "2025-11-19", "year": 2026, "quarter": 3, "period": "2026Q3", "epsActual": 1.0, "epsEstimate": 0.9, "revenueActual": 35e9, "revenueEstimate": 33e9},
        {"date": "2026-02-25", "year": 2026, "quarter": 4, "period": "2026Q4", "epsActual": 0.8, "epsEstimate": 0.85, "revenueActual": 39e9, "revenueEstimate": 38e9},
        {"date": "2026-05-27", "year": 2027, "quarter": 1, "period": "2027Q1", "epsActual": 1.1, "epsEstimate": 1.0, "revenueActual": 44e9, "revenueEstimate": 43e9},
        {"date": "2026-08-26", "year": 2027, "quarter": 2, "period": "2027Q2", "epsActual": 1.2, "epsEstimate": 1.1, "revenueActual": 47e9, "revenueEstimate": 46e9},
        {"date": "2026-11-19", "year": 2027, "quarter": 3, "period": "2027Q3", "epsActual": 1.3, "epsEstimate": 1.25, "revenueActual": 57e9, "revenueEstimate": 55.2e9},
    ]
    r = earnings.us_report("NVDA", "엔비디아", entries)
    assert r.id == "US:NVDA:2027Q3" and r.reported_on == date(2026, 11, 19)
    assert r.lines["revenue"] == {"cur": 57e9, "prev": 47e9, "yoy": 35e9}
    text = earnings.message(r)
    assert "3분기 실적 (회계연도 27년)" in text
    assert "매출 $57.0B\n예상 $55.2B보다 🔴+3% · 1년 전보다 🔴+63% · 지난 분기보다 🔴+21%" in text
    assert "EPS $1.30 · 예상 $1.25보다 🔴+4%" in text
    assert "최근 5번 EPS 🔴🔵🔴🔴🔴 · 예상보다 높음 4번" in text


def test_loss_beats_estimate():
    assert earnings.beat(-0.12, -0.16) == "🔴+25%"
    assert earnings.usd(-0.12) == "−$0.12"


def test_change_labels():
    assert earnings.change(5, -3) == "🔴흑자 전환"
    assert earnings.change(-5, -3) == "적자 지속"
    assert earnings.change(90, 100) == "🔵−10%"
    assert earnings.change(1, None) == ""
