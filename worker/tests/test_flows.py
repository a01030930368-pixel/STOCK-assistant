from datetime import date
from decimal import Decimal

import pytest

from app import flows


def test_parse_flows_sorts_and_signs():
    rows = [
        {"dt": "20261021", "cur_prc": "+241500", "frgnr_invsr": "+82000", "orgn": "-21000", "ind_invsr": "-61000"},
        {"dt": "20261020", "cur_prc": "236500", "frgnr_invsr": "-1500", "orgn": "+3000", "ind_invsr": "-1500"},
        {"dt": "", "cur_prc": "1"},
    ]
    out = flows.parse_flows(rows)
    assert [f.day for f in out] == [date(2026, 10, 20), date(2026, 10, 21)]
    assert out[1].close == Decimal("241500") and out[1].foreign == Decimal("82000") and out[1].institution == Decimal("-21000")


def test_parse_flows_names_unknown_fields():
    with pytest.raises(ValueError, match="frn"):
        flows.parse_flows([{"dt": "20261021", "frn": "1"}])


def test_parse_themes():
    rows = [{"thema_grp_cd": "319", "thema_nm": "HBM", "stk_num": "22", "flu_rt": "+4.80", "rising_stk_num": "18", "fall_stk_num": "3", "dt_prft_rt": "+9.60", "main_stk": "SK하이닉스"},
            {"thema_grp_cd": "", "thema_nm": "x"}]
    [t] = flows.parse_themes(rows)
    assert (t.code, t.name, t.stocks, t.change_pct, t.week_pct, t.rising, t.falling, t.leader) == ("319", "HBM", 22, Decimal("4.80"), Decimal("9.60"), 18, 3, "SK하이닉스")
    with pytest.raises(ValueError):
        flows.parse_themes([{"cd": "1"}])
