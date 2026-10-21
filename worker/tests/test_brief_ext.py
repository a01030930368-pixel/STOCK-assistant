from datetime import datetime, timezone
from decimal import Decimal

from app import brief, extended

CELLS = [
    {"key": "earnings", "title": "실적", "signal": "g", "text": "영업이익 +38%"},
    {"key": "flow", "title": "수급", "signal": "r", "text": "외국인 −1,200억"},
    {"key": "chart", "title": "차트 위치", "signal": "y", "text": "볼린저 상단"},
    {"key": "value", "title": "값어치", "signal": "n", "text": "자료 없음"},
]


def test_parse_and_fallback():
    one, good, bad = brief.parse('설명\n{"one": "실적은 좋아요", "good": ["- 이익 증가", "", "a", "b", "c", "d"], "bad": "x"}')
    assert one == "실적은 좋아요" and good == ["이익 증가", "a", "b", "c"] and bad == []
    good, bad = brief.fallback(CELLS)
    assert good == ["실적: 영업이익 +38%"] and bad == ["수급: 외국인 −1,200억", "차트 위치: 볼린저 상단"]
    assert "[조심]" in brief.build_prompt("SK하이닉스", "KR", CELLS)


class FakeConn:
    pass


def test_writer_falls_back_when_ai_fails(monkeypatch):
    done = []
    rows = [("000660", "SK하이닉스", "KR", CELLS)]
    monkeypatch.setattr("app.brief.db.pending_brief", lambda conn: rows.pop() if rows else None)
    monkeypatch.setattr("app.brief.db.finish_brief", lambda conn, *a: done.append(a))

    class Cfg:
        gemini_api_key = "k"; anthropic_api_key = None; ai_model = None

    w = brief.BriefWriter(Cfg(), None)

    def boom(*a):
        raise RuntimeError("busy")

    w.ask = boom
    assert w.run_once(FakeConn()) is True and w.run_once(FakeConn()) is False
    ticker, one, good, bad, model, error = done[0]
    assert ticker == "000660" and one is None and good == ["실적: 영업이익 +38%"] and "busy" in error


def test_session_at():
    # 2026-10-21 수요일, 뉴욕은 서머타임(UTC-4)
    assert extended.session_at(datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)) == "pre"     # 05:00 NY
    assert extended.session_at(datetime(2026, 10, 21, 15, 0, tzinfo=timezone.utc)) is None     # 11:00 NY 정규장
    assert extended.session_at(datetime(2026, 10, 21, 21, 0, tzinfo=timezone.utc)) == "post"   # 17:00 NY
    assert extended.session_at(datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)) is None      # 일요일


def _body(ts_close, pre=(100, 200), post=(300, 400), base=31.42):
    ts = [t for t, _ in ts_close]
    closes = [c for _, c in ts_close]
    return {"chart": {"result": [{
        "meta": {"regularMarketPrice": base, "currentTradingPeriod": {"pre": {"start": pre[0], "end": pre[1]}, "post": {"start": post[0], "end": post[1]}}},
        "timestamp": ts, "indicators": {"quote": [{"open": closes, "high": closes, "low": closes, "close": closes, "volume": [1] * len(ts)}]},
    }]}}


def test_parse_ext_takes_last_bar_outside_regular_hours():
    q = extended.parse_ext(_body([(120, 29.8), (180, 29.9), (240, 31.0), (360, 32.1)]), "IONQ")
    assert q.session == "post" and q.price == Decimal("32.1") and q.base == Decimal("31.42")
    q = extended.parse_ext(_body([(120, 29.8), (240, 31.0)]), "IONQ")
    assert q.session == "pre" and q.price == Decimal("29.8")
    assert extended.parse_ext(_body([(240, 31.0)]), "IONQ") is None
