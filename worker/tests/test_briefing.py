from datetime import date, datetime, timezone

import pytest

from app import briefing
from app.briefing import Item
from app.briefing_job import BriefingJob
from app.config import Config


@pytest.fixture(autouse=True)
def no_asset_db(monkeypatch):
    monkeypatch.setattr("app.briefing_job.db.record_assets", lambda conn, day: None)


def cfg(token="t", chat="c"):
    return Config(database_url="", kiwoom_appkey="", kiwoom_secretkey="", kiwoom_mock=True, telegram_bot_token=token,
                  telegram_chat_id=chat, poll_seconds=60)


def test_evening_due_after_8pm_kst():
    assert briefing.evening_due(datetime(2026, 10, 27, 10, 59, tzinfo=timezone.utc)) is None  # 19:59 KST
    assert briefing.evening_due(datetime(2026, 10, 27, 11, 0, tzinfo=timezone.utc)) == date(2026, 10, 28)


def test_evening_message_puts_rate_decisions_first():
    text = briefing.evening_message(date(2026, 10, 28), [
        Item("earnings", "아이온큐 실적 발표", "장 마감 후"),
        Item("policy", "FOMC 금리 결정", "미국 동부 14:00 · 한국 시간 다음 날 03:00"),
    ])
    assert text.splitlines()[0] == "[LODESTAR] 내일 일정 · 10.28 (수)"
    assert text.index("FOMC") < text.index("아이온큐")
    assert briefing.evening_message(date(2026, 10, 28), []) is None


def test_job_sends_once_per_day(monkeypatch):
    sent, marked = [], set()
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: key in marked)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: marked.add(key))
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [("policy", "FOMC 금리 결정", "")])
    monkeypatch.setattr("app.briefing_job.db.earnings_eve", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.review_inputs", lambda conn: ([], {}, set()))
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))
    now = datetime(2026, 10, 27, 11, 5, tzinfo=timezone.utc)
    job = BriefingJob(cfg(), None)
    job.run(None, now)
    job.run(None, now)
    assert len(sent) == 1 and marked == {"evening:2026-10-28"}
    BriefingJob(cfg(token=""), None).run(None, now.replace(day=28))
    assert len(sent) == 1


def test_morning_due_on_weekday_mornings_only():
    assert briefing.morning_due(datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc)) == date(2026, 10, 20)  # 화 08:00
    assert briefing.morning_due(datetime(2026, 10, 20, 2, 0, tzinfo=timezone.utc)) is None  # 화 11:00
    assert briefing.morning_due(datetime(2026, 10, 23, 23, 30, tzinfo=timezone.utc)) is None  # 토 08:30


def test_morning_message_sections():
    text = briefing.morning_message(
        date(2026, 10, 20),
        [briefing.Quote("나스닥", 21400.5, -0.21)],
        [briefing.Holding("삼성전자", "KR", 68400, 1.2, 5.0), briefing.Holding("아이온큐", "US", 31.11, None, -17.66)],
        [],
    )
    assert "· 나스닥 21,400.50 (-0.2%)" in text
    assert "· 삼성전자 68,400원 · +1.2% · +5.0%" in text
    assert "· 아이온큐 $31.11 · - · -17.7%" in text
    assert text.endswith("오늘 일정\n· 큰 일정은 없어요")


def test_morning_sends_even_when_an_index_fails(monkeypatch):
    sent, marked = [], set()
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: key in marked)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: marked.add(key))
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_holdings", lambda conn: [])
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))

    def daily(symbol, http, span):
        raise RuntimeError("blocked")

    monkeypatch.setattr("app.briefing_job.prices.yahoo_daily", daily)
    job = BriefingJob(cfg(), None)
    now = datetime(2026, 10, 19, 23, 5, tzinfo=timezone.utc)
    job.run(None, now)
    job.run(None, now)
    assert len(sent) == 1 and "morning:2026-10-20" in marked and "밤사이 미국장" not in sent[0]


def test_earnings_eve_message():
    e = briefing.EarningsEve("아이온큐", "US", "장 마감 후 · 예상 EPS -0.25", 5.0, 12.4, 38.5, 55.0, 18.2)
    text = briefing.earnings_eve_message(date(2026, 10, 28), e)
    assert text.splitlines()[:2] == ["[LODESTAR] 내일 실적 발표 · 아이온큐", "10.28 (수) · 장 마감 후 · 예상 EPS -0.25"]
    assert "예상보다 +18% 좋았어요" in text and "평단 대비 +5.0% · 내 돈의 12%" in text and "손절 $38.50 · 익절 $55.00" in text
    bare = briefing.earnings_eve_message(date(2026, 10, 28), briefing.EarningsEve("X", "KR", "", -3.0, None, None, None, None))
    assert "손절·익절 알림이 없어요" in bare and "지난번" not in bare


def test_earnings_eve_sends_once_per_stock(monkeypatch):
    sent, marked = [], set()
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: key in marked)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: marked.add(key))
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.earnings_eve", lambda conn, day: [
        ("IONQ", ("아이온큐", "US", "", 5.0, 10.0, None, None, None)), ("NVDA", ("엔비디아", "US", "", 1.0, 20.0, None, None, None))])
    monkeypatch.setattr("app.briefing_job.db.review_inputs", lambda conn: ([], {}, set()))
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))
    now = datetime(2026, 10, 27, 11, 5, tzinfo=timezone.utc)
    job = BriefingJob(cfg(), None)
    job.run(None, now)
    job.run(None, now)
    assert len(sent) == 2 and {"earnings:IONQ:2026-10-28", "earnings:NVDA:2026-10-28"} <= marked


def _t(day, side, qty, price, fee=None, ticker="000660"):
    from decimal import Decimal
    from app.books import Trade
    return Trade("KR", ticker, "SK하이닉스", date.fromisoformat(day), None, side, Decimal(qty), Decimal(price), Decimal(fee) if fee else None)


def test_closed_books_match_the_web_diary():
    from decimal import Decimal
    from app.books import closed_books
    trades = [_t("2026-08-04", "buy", 10, 168000, 250), _t("2026-08-21", "buy", 5, 181500), _t("2026-09-15", "sell", 7, 214000, 3000),
              _t("2026-10-14", "sell", 8, 251000, 3000), _t("2026-10-17", "buy", 2, 260000)]
    [b] = closed_books(trades, {("KR", "000660"): Decimal(2)})
    realized = 7 * 41500 + 8 * 78500 - 6250
    assert (b.key, b.start, b.realized, b.return_pct) == ("KR:000660:2026-10-14", date(2026, 8, 4), realized, round(realized / (15 * 172500) * 100, 2))
    [old] = closed_books([_t("2026-08-01", "sell", 3, 50000)], {})
    assert (old.start, old.realized, old.return_pct, old.bought) == (None, None, None, False)
    assert b.bought


def test_review_reminder_once_after_full_sell(monkeypatch):
    sent, marked = [], set()
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: key in marked)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: marked.add(key))
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.earnings_eve", lambda conn, day: [])
    trades = [_t("2026-10-01", "buy", 10, 100), _t("2026-10-14", "sell", 10, 120),
              _t("2026-10-01", "buy", 1, 100, ticker="X"), _t("2026-10-20", "sell", 1, 90, ticker="X")]
    monkeypatch.setattr("app.briefing_job.db.review_inputs", lambda conn: (trades, {}, set()))
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))
    job = BriefingJob(cfg(), None)
    job.run(None, datetime(2026, 10, 20, 11, 5, tzinfo=timezone.utc))  # 10-20 20:05 KST
    job.run(None, datetime(2026, 10, 20, 11, 35, tzinfo=timezone.utc))
    reviews = [t for t in sent if "다 팔았어요" in t]
    assert len(reviews) == 1  # 오늘(10-20) 판 X는 내일 알려요
    assert reviews[0].splitlines()[:2] == ["[LODESTAR] 다 팔았어요 · SK하이닉스", "10.01 → 10.14 · 13일 · 수익률 +20.0% (+200원)"]
    monkeypatch.setattr("app.briefing_job.db.review_inputs", lambda conn: (trades, {}, {"KR:X:2026-10-20"}))
    job.run(None, datetime(2026, 10, 21, 11, 5, tzinfo=timezone.utc))
    assert len([t for t in sent if "다 팔았어요" in t]) == 1  # 강평을 이미 쓴 권은 안 알려요


def test_weekly_due_on_sunday_evening():
    assert briefing.weekly_due(datetime(2026, 10, 25, 10, 59, tzinfo=timezone.utc)) is None  # 일 19:59 KST
    assert briefing.weekly_due(datetime(2026, 10, 25, 11, 0, tzinfo=timezone.utc)) == date(2026, 10, 19)
    assert briefing.weekly_due(datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)) is None  # 토요일


def test_weekly_message_sections():
    w = briefing.Week(date(2026, 10, 19), 123_450_000, 122_000_000, [("SK하이닉스", 6.1), ("아이온큐", -3.2)], 3, 2,
                      {"KR": 320_000, "US": -12.5}, [("SK하이닉스", 35.2)], 2, [(date(2026, 10, 28), "policy", "FOMC 금리 결정")])
    text = briefing.weekly_message(w)
    lines = text.splitlines()
    assert lines[0] == "[LODESTAR] 이번 주 성적표 · 10.19 (월) ~ 10.25 (일)"
    assert lines[1] == "내 돈 1억 2,345만원 · 지난주보다 +1.2% (+145만원)"
    assert "· 오른 종목: SK하이닉스 +6.1%" in lines and "· 내린 종목: 아이온큐 -3.2%" in lines
    assert "이번 주 매매 · 매수 3번 · 매도 2번" in lines and "· 판 것 손익(국내) +32만원" in lines and "· 판 것 손익(미국) -$12.50" in lines
    assert "· 다 판 종목: SK하이닉스 +35.2%" in lines and "사후강평 안 쓴 일기장 2권 · 매매일지 → 일기장에서 써 보세요" in lines
    assert lines[-1] == "· 10.28 (수) FOMC 금리 결정"
    empty = briefing.weekly_message(briefing.Week(date(2026, 10, 19), 5_000_000, None, [], 0, 0, {}, [], 0, []))
    assert "지난주 기록이 없어서 다음 주부터 비교해 드려요" in empty and "이번 주 매매 · 없었어요" in empty and empty.endswith("큰 일정은 없어요")


def test_weekly_report_once(monkeypatch):
    sent, marked = [], set()
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: key in marked)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: marked.add(key))
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.earnings_eve", lambda conn, day: [])
    trades = [_t("2026-10-01", "buy", 10, 100, 10), _t("2026-10-20", "sell", 4, 120, 5), _t("2026-10-21", "sell", 6, 90)]
    monkeypatch.setattr("app.briefing_job.db.review_inputs", lambda conn: (trades, {}, set()))
    monkeypatch.setattr("app.briefing_job.db.weekly_inputs", lambda conn, a, b: (1_050_000, 1_000_000, [], []))
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))
    job = BriefingJob(cfg(), None)
    job.run(None, datetime(2026, 10, 25, 11, 5, tzinfo=timezone.utc))
    job.run(None, datetime(2026, 10, 25, 11, 40, tzinfo=timezone.utc))
    [w] = [t for t in sent if "이번 주 성적표" in t]
    assert "매수 0번 · 매도 2번" in w and "· 판 것 손익(국내) +15원" in w and "· 다 판 종목: SK하이닉스 +0.5%" in w
    assert "weekly:2026-10-19" in marked
