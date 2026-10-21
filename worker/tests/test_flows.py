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


def test_flow_job_fetches_once_after_each_close(monkeypatch):
    from datetime import datetime, timezone
    from app import flow_job

    calls = []
    monkeypatch.setattr(flow_job.db, "save_flows", lambda conn, t, rows: calls.append(t))
    monkeypatch.setattr(flow_job.db, "set_setting", lambda *a: None)

    class Kiwoom:
        fail = False

        def investor_flows(self, ticker, day):
            if self.fail:
                raise RuntimeError("막힘")
            return []

    k = Kiwoom()
    job = flow_job.FlowJob(k)
    utc = lambda *a: datetime(*a, tzinfo=timezone.utc)
    targets = [("005930", "삼성전자")]
    job._flows(None, utc(2026, 10, 19, 15, 0), False, targets)   # 월 자정(KST) 처음 한 번
    job._flows(None, utc(2026, 10, 19, 15, 5), False, targets)   # 장 전에는 다시 안 받음
    job._flows(None, utc(2026, 10, 20, 7, 0), False, targets)  # 화 16:00 KST 마감 뒤 → 받음
    job._flows(None, utc(2026, 10, 20, 7, 30), False, targets)   # 같은 마감은 한 번만
    k.fail = True
    job._flows(None, utc(2026, 10, 21, 7, 0), False, targets)    # 수 마감 뒤 실패 → 표시 안 함
    k.fail = False
    job._flows(None, utc(2026, 10, 21, 7, 20), False, targets)   # 15분 뒤 다시 받음
    assert len(calls) == 3
