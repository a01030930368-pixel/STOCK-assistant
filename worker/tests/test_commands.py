from datetime import date

from app import bot, commands
from app.commands import Account


def test_parse_korean_english_and_bot_suffix():
    assert commands.parse("/잔고") == "balance"
    assert commands.parse("/balance@lodestar_bot") == "balance"
    assert commands.parse("관심 ") == "watch"
    assert commands.parse("안녕하세요") is None
    assert commands.parse("") is None


def test_balance_converts_dollars():
    text = commands.balance_text([Account("KR", 2_000_000, 100_000, 5.26, 500_000), Account("US", 1_000, -50, -4.76, 200)], 1_400)
    assert "총자산 4,180,000원" in text
    assert "· 해외 주식 $1,000.00 (-4.76%, $-50.00)" in text
    assert "예수금 500,000원" in text


def test_lists():
    assert "· 삼성전자 61,200원 · +3.10%" in commands.holdings_text([("삼성전자", "KR", 61200, 3.1)])
    assert "· 카카오 알림 36,500원 아래로 · -6.3%" in commands.alerts_text([("카카오", "KR", "custom", "below", 36500, 38950)])
    assert commands.calendar_text([(date(2026, 10, 21), "미국 CPI"), (date(2026, 10, 21), "FOMC")]).count("10.21 (수)") == 1
    assert "목표 $45.00 (+6.9%)" in commands.watch_text([("팔란티어", "US", 42.1, 2.4, 45)])
    assert "현재가 확인 중" in commands.watch_text([("삼성전자", "KR", None, None, 58000)])


def test_handle_ignores_other_chats_and_plain_talk():
    upd = lambda chat, text: {"update_id": 1, "message": {"chat": {"id": chat}, "text": text}}
    assert bot.handle(None, upd(999, "/잔고"), "123", date(2026, 10, 20)) is None
    assert bot.handle(None, upd(123, "그냥 하는 말"), "123", date(2026, 10, 20)) is None
    assert "명령" in bot.handle(None, upd(123, "/모르는명령"), "123", date(2026, 10, 20))
    assert "명령" in bot.handle(None, upd(123, "/help"), "123", date(2026, 10, 20))
