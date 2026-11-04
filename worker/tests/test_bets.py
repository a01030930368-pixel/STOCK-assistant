from datetime import date

from app import bets


def test_target_period_is_next_after_last_reported():
    assert bets.target_period(["2026Q2", "2026Q3"], date(2026, 11, 3)) == "2026Q4"
    assert bets.target_period(["2025Q4"], date(2026, 1, 5)) == "2026Q1"
    assert bets.target_period([], date(2026, 11, 3)) == "2026Q3"
    assert bets.target_period([], date(2026, 2, 3)) == "2025Q4"


def test_direction_band():
    assert bets.direction(103, 100) == "up"
    assert bets.direction(101.5, 100) == "same"
    assert bets.direction(97, 100) == "down"
    # 적자 예상(-100)보다 적자가 줄면(-90) 더 좋게 나온 것
    assert bets.direction(-90, -100) == "up"


def test_score_against_consensus_and_my_number():
    bet = {"rev_dir": "up", "rev_value": 34.5e12, "op_dir": "same", "op_value": None, "px_dir": "down"}
    r = bets.score(bet, {"rev": 35e12, "op": 17e12}, {"rev": 33.4e12, "op": 15.8e12}, -2.1)
    assert r["rev"]["ok"] is True and r["rev"]["by"] == "consensus"
    assert r["op"]["ok"] is False and r["op"]["got"] == "up"
    assert r["px"]["ok"] is True
    assert (r["hits"], r["total"]) == (2, 3)

    # 시장 예상이 없으면 적어 둔 숫자와 5% 안인지로 봐요. 숫자도 없으면 채점 불가.
    r = bets.score({"rev_dir": "up", "rev_value": 100.0, "op_dir": "up"}, {"rev": 104.0, "op": 10.0}, {}, None)
    assert r["rev"]["ok"] is True and r["rev"]["by"] == "mine"
    assert r["op"]["ok"] is None
    assert "px" not in r
    assert (r["hits"], r["total"]) == (1, 1)


def test_reaction_uses_first_trading_day_after_release():
    closes = [(date(2026, 10, 22), 100.0), (date(2026, 10, 23), 103.0), (date(2026, 10, 24), 99.0)]
    assert round(bets.reaction(closes, date(2026, 10, 23)), 2) == -1.0  # 장 마감 뒤 발표 → 다음 날
    assert round(bets.reaction(closes, date(2026, 10, 23), "bmo"), 2) == 3.0  # 개장 전 발표 → 그날
    assert bets.reaction(closes, date(2026, 10, 24)) is None


def test_texts():
    r = {"rev": {"ok": True}, "op": {"ok": False}, "px": {"ok": True, "actual": -2.1}, "hits": 2, "total": 3}
    t = bets.score_text("SK하이닉스", "2026Q3", r, 80)
    assert "26년 3분기" in t and "매출 ✓ · 영업이익 ✗ · 주가 ✓" in t and "3문제 중 2개" in t and "-2.1%" in t
    assert "미리 적어" in bets.pre_text("SK하이닉스", "2026Q4", date(2027, 1, 28), False)
    assert "한 번 더" in bets.pre_text("SK하이닉스", "2026Q4", date(2027, 1, 28), True)
