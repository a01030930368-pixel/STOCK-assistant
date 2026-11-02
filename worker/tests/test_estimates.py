from datetime import date

from app import estimates


def test_finnhub_merges_calendar_and_eps_history():
    cal = [
        {"date": "2025-10-23", "year": 2025, "quarter": 3, "epsActual": 0.2, "epsEstimate": 0.01, "revenueActual": 13.6e9, "revenueEstimate": 13.1e9, "hour": "amc"},
        {"date": "2026-01-22", "year": 2025, "quarter": 4, "epsActual": None, "revenueActual": None},  # 아직 안 나옴
    ]
    eps = [{"year": 2025, "quarter": 3, "actual": 0.23, "estimate": 0.02}, {"year": 2025, "quarter": 2, "actual": -0.1, "estimate": 0.01}]
    rows = estimates.finnhub_estimates("INTC", cal, eps)
    assert [r.period for r in rows] == ["2025Q2", "2025Q3"]
    q3 = rows[1]
    assert (q3.eps_actual, q3.eps_estimate, q3.revenue_estimate, q3.hour) == (0.2, 0.01, 13.1e9, "amc")
    assert q3.reported_on == date(2025, 10, 23)
    assert (rows[0].eps_actual, rows[0].eps_estimate, rows[0].reported_on) == (-0.1, 0.01, None)


def test_naver_keeps_only_consensus_columns_in_won():
    body = {"financeInfo": {
        "trTitleList": [{"isConsensus": "N", "title": "2026.06.", "key": "202606"}, {"isConsensus": "Y", "title": "2026.09.(E)", "key": "202609"}],
        "rowList": [
            {"title": "매출액", "columns": {"202606": {"value": "740,000"}, "202609": {"value": "860,617"}}},
            {"title": "영업이익", "columns": {"202609": {"value": "101,234"}}},
            {"title": "당기순이익", "columns": {"202609": {"value": "-"}}},
            {"title": "매출총이익", "columns": {"202609": {"value": "1"}}},
            {"title": "EPS(원)", "columns": {"202609": {"value": "1,234"}}},
        ]}}
    rows = estimates.naver_estimates("005930", body)
    assert len(rows) == 1
    r = rows[0]
    assert (r.period, r.source, r.market) == ("2026Q3", "naver", "KR")
    assert r.revenue_estimate == 860617 * estimates.EOK and r.op_estimate == 101234 * estimates.EOK
    assert r.net_estimate is None and r.eps_estimate == 1234
    assert estimates.naver_estimates("005930", {"unexpected": 1}) == []


class FakeConn:
    def __init__(self, reported):
        self.reported, self.saved = reported, []

    def execute(self, sql, args=()):
        if sql.lstrip().startswith("SELECT"):
            return type("R", (), {"fetchall": lambda _: [(p,) for p in self.reported]})()
        self.saved.append(args[1])


def test_kr_estimate_freezes_once_the_quarter_is_reported():
    conn = FakeConn({"2026Q3"})
    rows = [estimates.Estimate("005930", "2026Q3", "KR", "naver", revenue_estimate=1), estimates.Estimate("005930", "2026Q4", "KR", "naver", revenue_estimate=2),
            estimates.Estimate("INTC", "2026Q3", "US", "finnhub", eps_actual=1)]
    assert estimates.save(conn, rows, date(2026, 11, 2)) == 2
    assert conn.saved == ["2026Q4", "2026Q3"]
