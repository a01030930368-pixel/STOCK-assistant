from datetime import date, timedelta

import pytest

from app import lab
from app.lab import Bar


def bars_from(closes, start=date(2024, 1, 1), opens=None, lows=None, highs=None, vols=None):
    out = []
    for i, c in enumerate(closes):
        out.append(Bar(start + timedelta(days=i), opens[i] if opens else c, highs[i] if highs else c, lows[i] if lows else c, c,
                       vols[i] if vols else 1000))
    return out


def rule(buy, sell, market="ALL", years=5):
    return lab.clean_rule({"buy": buy, "sell": sell, "market": market, "years": years})


def test_clean_rule_needs_buy_and_sell():
    with pytest.raises(ValueError):
        lab.clean_rule({"buy": {}, "sell": {"stop": 5}})
    with pytest.raises(ValueError):
        lab.clean_rule({"buy": {"ma20": True}, "sell": {}})
    r = lab.clean_rule({"buy": {"ma20": True, "junk": True}, "sell": {"stop": "7", "days": 0}, "market": "XX", "years": 2})
    assert r["buy"] == {"ma20": True, "rsi30": False, "high52": False, "vol2": False, "support": False}
    assert r["sell"] == {"stop": 7.0, "target": None, "days": None, "ma20break": False}
    assert r["market"] == "ALL" and r["years"] == 5


def test_sma_and_rsi():
    assert lab.sma([1, 2, 3, 4], 2) == [None, 1.5, 2.5, 3.5]
    up = lab.rsi([float(i) for i in range(30)])
    assert up[13] is None and up[14] == 100.0
    down = lab.rsi([float(100 - i) for i in range(30)])
    assert down[-1] < 1


def test_volume_and_high52_signals():
    closes = [100.0] * 300
    closes[280] = 120.0
    vols = [1000] * 300
    vols[290] = 2500
    bs = bars_from(closes, vols=vols)
    hi = lab.signals(bs, {"high52": True})
    assert hi[280] and not hi[279]
    v = lab.signals(bs, {"vol2": True})
    assert v[290] and sum(v) == 1


def test_support_touch():
    closes = [100.0] * 61 + [101.0]
    lows = [100.0] * 61 + [100.5]
    bs = bars_from(closes, lows=lows)
    assert lab.signals(bs, {"support": True})[61]
    bs2 = bars_from([100.0] * 61 + [110.0], lows=[100.0] * 61 + [108.0])
    assert not lab.signals(bs2, {"support": True})[61]


def test_trade_target_stop_and_days():
    # 20일선 위 신호 → 다음 날 시가에 사서 +10% 익절
    closes = [100.0] * 25 + [101.0, 102.0, 105.0, 112.0, 113.0]
    highs = closes[:]
    bs = bars_from(closes, highs=highs)
    r = rule({"ma20": True}, {"target": 10, "stop": 5})
    t = lab.run_ticker(bs, r, date(2000, 1, 1))
    assert t[0]["b"] == bs[26].day.isoformat() and t[0]["bp"] == 102.0
    # 112는 목표(112.2)에 못 미치고, 다음 날 시가 113이 목표 위라 시가에 팔아요
    assert t[0]["why"] == "익절" and t[0]["sp"] == 113.0
    assert t[0]["r"] == pytest.approx(round((113 / 102 - 1) * 100 - lab.COST, 2))
    highs[28] = 112.5
    t = lab.run_ticker(bars_from(closes, highs=highs), r, date(2000, 1, 1))
    assert t[0]["sp"] == pytest.approx(112.2) and t[0]["r"] == pytest.approx(10 - lab.COST)
    # 손절: 갭으로 시가가 손절가 아래면 시가에
    closes = [100.0] * 25 + [101.0, 102.0, 90.0, 90.0, 90.0]
    opens = closes[:]
    opens[27] = 92.0
    t = lab.run_ticker(bars_from(closes, opens=opens), r, date(2000, 1, 1))
    assert t[0]["why"] == "손절" and t[0]["sp"] == 92.0
    # N일 뒤
    r3 = rule({"ma20": True}, {"days": 3})
    closes = [100.0] * 25 + [101.0, 102.0, 103.0, 104.0, 105.0, 106.0]
    t = lab.run_ticker(bars_from(closes), r3, date(2000, 1, 1))
    assert t[0]["why"] == "3일 뒤" and t[0]["d"] == 3 and t[0]["s"] == bars_from(closes)[28].day.isoformat()


def test_signals_before_since_are_skipped():
    closes = [100.0] * 25 + [101.0 + i for i in range(10)]
    bs = bars_from(closes)
    r = rule({"ma20": True}, {"days": 2})
    assert lab.run_ticker(bs, r, bs[-1].day + timedelta(days=1)) == []


def test_summarize_hist_and_backtest_market_filter():
    s = lab.summarize([{"r": 5.0, "d": 2, "hold": 1.0}, {"r": -25.0, "d": 4, "hold": -2.0}, {"r": 30.0, "d": 6, "hold": 3.0}])
    assert s["n"] == 3 and s["wins"] == 2 and s["winPct"] == 66.7 and s["worst"] == -25.0 and s["avgDays"] == 4.0
    assert s["hist"][0] == 1 and s["hist"][-1] == 1 and sum(s["hist"]) == 3
    closes = [100.0] * 25 + [101.0 + i for i in range(10)]
    uni = [("A", "에이", "KR", bars_from(closes)), ("B", "비", "US", bars_from(closes))]
    res = lab.backtest(uni, rule({"ma20": True}, {"days": 2}, market="KR"), date(2024, 3, 1))
    assert res["tickers"] == 1 and all(t["t"] == "A" for t in res["trades"])


def test_keep_trades_keeps_extremes():
    trades = [{"b": f"2024-01-{i % 28 + 1:02d}", "r": float(i)} for i in range(100)]
    kept = lab.keep_trades(trades, cap=20)
    rs = {t["r"] for t in kept}
    assert len(kept) == 20 and 0.0 in rs and 99.0 in rs


def test_parse_answer():
    out = lab.parse_answer('답: {"buy":{"rsi30":true},"sell":{"stop":7,"target":15},"market":"KR","years":3,"unsupported":["PER 10 아래"],"name":"눌림"}')
    assert out["rule"]["buy"]["rsi30"] and out["rule"]["sell"]["stop"] == 7 and out["rule"]["market"] == "KR"
    assert out["unsupported"] == ["PER 10 아래"] and out["name"] == "눌림"
    bad = lab.parse_answer('{"buy":{},"sell":{"stop":5},"unsupported":["PER"]}')
    assert bad["rule"] is None and "살 때 조건" in bad["unsupported"][-1]
