from datetime import date, datetime, timedelta, timezone

from app import screener
from app.screener_job import due


def bars(closes, vols=None):
    start = date(2026, 1, 1)
    vols = vols or [1000] * len(closes)
    return [screener.Bar(start + timedelta(days=i), c, c, v, c * v) for i, (c, v) in enumerate(zip(closes, vols))]


def test_to_won_detects_million_unit():
    assert screener.to_won(10000, 1_000_000, 10000) == 10_000_000_000
    assert screener.to_won(10000, 1_000_000, 10_000_000_000) == 10_000_000_000
    assert screener.to_won(10000, 0, 0) == 0


def test_parse_value_rank_strips_suffix_and_skips_non_numeric():
    body = {"return_code": 0, "trde_prica_upper": [
        {"stk_cd": "005930_AL", "stk_nm": "삼성전자 ", "cur_prc": "+61200", "now_trde_qty": "1000000", "trde_prica": "61200"},
        {"stk_cd": "00104K", "stk_nm": "ETN", "cur_prc": "1", "now_trde_qty": "1", "trde_prica": "1"},
    ]}
    rows = screener.parse_value_rank(body)
    assert [(r.ticker, r.name) for r in rows] == [("005930", "삼성전자")]
    assert rows[0].value == 61_200_000_000


def test_rsi_extremes():
    assert screener.rsi(list(range(1, 30))) == 100.0
    assert screener.rsi([float(x) for x in range(30, 1, -1)]) < 1
    assert screener.rsi([1.0] * 5) is None


def test_metrics_golden_cross_and_volume_ratio():
    closes = [100.0] * 25 + [90.0] * 5 + [120.0, 125.0]
    vols = [1000] * 31 + [3000]
    m = screener.metrics("000001", "테스트", bars(closes, vols))
    assert m.golden_cross
    assert round(m.volume_ratio, 1) == 3.0
    assert round(m.change_pct, 2) == 4.17
    assert m.near_high_pct == 0


def test_with_today_overrides_last_bar():
    b = bars([100.0, 101.0])
    row = screener.RankRow("000001", "x", 110.0, 5000, 550000)
    out = screener.with_today(b, b[-1].day, row)
    assert out[-1].close == 110.0 and out[-1].volume == 5000 and len(out) == 2


def test_due_every_30_minutes_in_market_and_once_after_close():
    open_time = datetime(2026, 10, 20, 2, 0, tzinfo=timezone.utc)  # 화 11:00 KST
    assert due(open_time, None)
    assert not due(open_time, open_time - timedelta(minutes=10))
    assert due(open_time, open_time - timedelta(minutes=31))
    after = datetime(2026, 10, 20, 7, 0, tzinfo=timezone.utc)  # 16:00 KST
    assert due(after, datetime(2026, 10, 20, 6, 20, tzinfo=timezone.utc))
    assert not due(after, datetime(2026, 10, 20, 6, 45, tzinfo=timezone.utc))
