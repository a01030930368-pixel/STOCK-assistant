from datetime import date
from decimal import Decimal

from app import sectors


def test_all_sectors_skips_composite_and_size_indices():
    body = {"all_inds_idex": [
        {"stk_cd": "001", "stk_nm": "종합(KOSPI)", "cur_prc": "-2394.49", "flu_rt": "-1.20", "wght": ""},
        {"stk_cd": "002", "stk_nm": "대형주", "cur_prc": "2300.00", "flu_rt": "-1.00"},
        {"stk_cd": "013", "stk_nm": "전기·전자", "cur_prc": "+31234.56", "flu_rt": "+3.10", "wght": "34.12"},
        {"stk_cd": "021", "stk_nm": "금융", "cur_prc": "-812.30", "flu_rt": "-0.40", "wght": ""},
        {"stk_cd": "027", "stk_nm": "제조", "cur_prc": "6000.00", "flu_rt": "0.10"},
        {"stk_cd": "151", "stk_nm": "코스피200 커뮤니케이션", "cur_prc": "1000.00", "flu_rt": "0.10"},
    ]}
    rows = sectors.parse_all_sectors(body)
    assert [r.code for r in rows] == ["013", "021"]
    assert rows[0].price == Decimal("31234.56") and rows[0].change_pct == Decimal("3.10") and rows[0].weight == Decimal("34.12")
    assert rows[1].change_pct == Decimal("-0.40") and rows[1].weight is None


def test_sector_daily_undoes_hundredfold_prices():
    body = {"inds_dt_pole_qry": [{"dt": "20261021", "cur_prc": "252127"}, {"dt": "20261020", "cur_prc": "250000"}, {"dt": "", "cur_prc": "1"}]}
    assert sectors.parse_sector_daily(body, Decimal("2521.27")) == [(date(2026, 10, 20), Decimal("2500")), (date(2026, 10, 21), Decimal("2521.27"))]
    # 이미 소수로 오면 그대로
    assert sectors.parse_sector_daily({"inds_dt_pole_qry": [{"dt": "20261021", "cur_prc": "2521.27"}]}, Decimal("2521.27"))[0][1] == Decimal("2521.27")


def test_leaders_and_day_change():
    body = {"inds_stkpc": [{"stk_nm": "삼성전자", "flu_rt": "+1.10"}, {"stk_nm": "SK하이닉스", "flu_rt": "+4.20"}, {"stk_nm": "LG전자", "flu_rt": "-2.50"}]}
    assert sectors.parse_leaders(body) == [{"name": "SK하이닉스", "pct": 4.2}, {"name": "LG전자", "pct": -2.5}]
    assert sectors.day_change([Decimal("100"), Decimal("103.1")]) == Decimal("3.10")
    assert sectors.day_change([Decimal("100")]) == Decimal(0)
