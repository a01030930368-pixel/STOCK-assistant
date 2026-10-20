from datetime import date, datetime, timezone

from app import briefing
from app.briefing import Item
from app.briefing_job import BriefingJob
from app.config import Config


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
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))
    now = datetime(2026, 10, 27, 11, 5, tzinfo=timezone.utc)
    job = BriefingJob(cfg(), None)
    job.run(None, now)
    job.run(None, now)
    assert len(sent) == 2 and {"earnings:IONQ:2026-10-28", "earnings:NVDA:2026-10-28"} <= marked
