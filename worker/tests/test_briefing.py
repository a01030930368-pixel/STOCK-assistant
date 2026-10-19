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
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http: sent.append(text))
    now = datetime(2026, 10, 27, 11, 5, tzinfo=timezone.utc)
    job = BriefingJob(cfg(), None)
    job.run(None, now)
    job.run(None, now)
    assert len(sent) == 1 and marked == {"evening:2026-10-28"}
    BriefingJob(cfg(token=""), None).run(None, now.replace(day=28))
    assert len(sent) == 1
