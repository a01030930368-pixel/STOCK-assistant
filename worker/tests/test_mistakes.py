import json
from datetime import date, datetime, timezone
from decimal import Decimal

from app import mistakes
from app.mistakes_job import MistakesJob


def sell(sid, ret, lesson="손절가 근처라 하루만 더 버텼다", stop=100, price=90):
    return mistakes.sell_item((sid, f"종목{sid}", date(2026, 9, sid), Decimal(str(ret)), 10, "other", "", lesson, False,
                               Decimal(price), Decimal(stop), None))


def test_sell_line_shows_gap_to_stop():
    i = sell(1, -18.4)
    assert i.id == "s1" and "수익률 -18.4%" in i.text and "손절가 100.00 대비 판 가격 -10.0%" in i.text and "원칙 지킴 아니오" in i.text


def test_assemble_counts_from_records_not_from_ai():
    items = [sell(1, -18.4), sell(2, -11.2), sell(3, 6.0, "아쉽다 더 기다렸으면"), sell(4, 4.0, "아쉽다")]
    raw = {"mistakes": [
        {"title": "손절을 미뤘어요", "why": "손절가 아래에서 팔았어요", "ids": ["s1", "s2", "s9"]},  # s9는 없는 기록
        {"title": "한 번만", "why": "", "ids": ["s3"]},
        {"title": "익절을 일찍 했어요", "why": "", "ids": ["s3", "s4"]},
    ], "good": "비중을 지켰어요", "summary": "요약", "next": "바로 정리", "phrases": ["아쉽다", "없는 말", "하루만 더"]}
    r = mistakes.assemble(raw, items)
    first, second = r["mistakes"]
    assert (first["title"], first["count"], first["avg"]) == ("손절을 미뤘어요", 2, -14.8)
    assert [e["ref"] for e in first["examples"]] == ["1", "2"]  # 손해가 큰 순서
    assert [e["ref"] for e in second["examples"]] == ["3", "4"]  # 이익만 있으면 이익이 큰 순서
    assert r["phrases"] == [{"text": "아쉽다", "count": 2}, {"text": "하루만 더", "count": 2}]
    assert (r["sells"], r["reviews"]) == (4, 0)


class Cfg:
    gemini_api_key = "g"
    anthropic_api_key = ""
    ai_model = ""


def test_job_reads_when_asked_and_keeps_numbers_from_records(monkeypatch):
    settings = {"mistakes": {"at": "2026-10-20T00:00:00+00:00"}, "mistakes_request": "2026-10-21T01:00:00+00:00"}
    monkeypatch.setattr("app.db.get_setting", lambda conn, k: settings.get(k))
    monkeypatch.setattr("app.db.set_setting", lambda conn, k, v: settings.__setitem__(k, v))
    monkeypatch.setattr("app.db.mistake_sells", lambda conn, since: [
        (n, f"종목{n}", date(2026, 9, n), Decimal("-5"), 3, "stop", "", "늦었다", False, Decimal(90), Decimal(100), None) for n in (1, 2, 3)])
    monkeypatch.setattr("app.db.mistake_reviews", lambda conn: [])
    monkeypatch.setattr("app.db.review_inputs", lambda conn: ([], {}, set()))
    job = MistakesJob(Cfg(), None)
    seen = []
    job.ask = lambda system, prompt, key, model, http, n: seen.append(prompt) or json.dumps(
        {"mistakes": [{"title": "손절을 미뤘어요", "why": "", "ids": ["s1", "s2", "s3"]}], "summary": "s", "next": "n"})
    now = datetime(2026, 10, 21, 2, tzinfo=timezone.utc)
    job.run(object(), now)
    assert "[s1] 매도 · 종목1" in seen[0]
    assert settings["mistakes"]["mistakes"][0]["count"] == 3 and settings["mistakes"]["at"] == now.isoformat()
    job.run(object(), now)  # 이미 읽었으니 다시 안 읽어요
    assert len(seen) == 1


def test_job_waits_for_enough_records(monkeypatch):
    settings = {}
    monkeypatch.setattr("app.db.get_setting", lambda conn, k: settings.get(k))
    monkeypatch.setattr("app.db.set_setting", lambda conn, k, v: settings.__setitem__(k, v))
    monkeypatch.setattr("app.db.mistake_sells", lambda conn, since: [])
    monkeypatch.setattr("app.db.mistake_reviews", lambda conn: [])
    monkeypatch.setattr("app.db.review_inputs", lambda conn: ([], {}, set()))
    job = MistakesJob(Cfg(), None)
    job.ask = lambda *a: (_ for _ in ()).throw(AssertionError("AI를 부르면 안 돼요"))
    job.run(object(), datetime(2026, 10, 21, tzinfo=timezone.utc))
    assert settings["mistakes"]["few"] == 0


def test_sell_and_review_of_same_trade_count_once():
    s1 = mistakes.sell_item((1, "스트레티지", date(2026, 9, 1), Decimal("29.4"), 10, "other", "운에 기대", "도박이었다", False,
                             Decimal(90), None, None, "US", "MSTR"))
    s1 = mistakes.Item(**{**s1.__dict__, "trade": "US:MSTR:2026-09-01"})
    r1 = mistakes.review_item(1, "US:MSTR:2026-09-01", "STRATEGY INC", date(2026, 9, 1), 29.4, (2, False, "", "", "", "도박"))
    s2 = sell(2, -5.0)
    assert "[s1]" in mistakes.build_prompt([s1, r1, s2]) and "같은 매매 r1" in mistakes.build_prompt([s1, r1, s2])
    raw = {"mistakes": [{"title": "도박처럼 매매했어요", "why": "", "ids": ["s1", "r1"]},
                        {"title": "운에 기댔어요", "why": "", "ids": ["s1", "r1", "s2"]}]}
    r = mistakes.assemble(raw, [s1, r1, s2])
    assert [m["title"] for m in r["mistakes"]] == ["운에 기댔어요"]  # 한 매매뿐인 실수는 빠져요
    m = r["mistakes"][0]
    assert m["count"] == 2 and [e["name"] for e in m["examples"]] == ["종목2", "스트레티지"]
    assert m["examples"][1]["kind"] == "book"


def test_job_links_sell_to_its_book(monkeypatch):
    from app import books
    monkeypatch.setattr("app.db.mistake_sells", lambda conn, since: [
        (1, "스트레티지", date(2026, 9, 1), Decimal("29.4"), 10, "other", "", "도박", False, Decimal(90), None, None, "US", "MSTR")])
    monkeypatch.setattr("app.db.mistake_reviews", lambda conn: [("US:MSTR:2026-09-01", 2, False, "", "", "", "도박")])
    monkeypatch.setattr("app.db.review_inputs", lambda conn: ([], {}, set()))
    book = books.ClosedBook("US:MSTR:2026-09-01", "US", "MSTR", "STRATEGY INC", date(2026, 8, 1), date(2026, 9, 1), 29.4, None)
    monkeypatch.setattr("app.books.closed_books", lambda trades, held: [book])
    items = MistakesJob(Cfg(), None).items(object(), datetime(2026, 10, 21, tzinfo=timezone.utc))
    assert {i.trade for i in items} == {"US:MSTR:2026-09-01"}
