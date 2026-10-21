from datetime import datetime, timedelta, timezone

from app import ask, bot

KNOWN = [("000660", "SK하이닉스", "KR"), ("005930", "삼성전자", "KR"), ("NVDA", "엔비디아", "US"), ("IONQ", "아이온큐", "US")]
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def test_find_stocks_by_name_part_and_ticker():
    assert [s[0] for s in ask.find_stocks("하이닉스는 오늘 왜 빠졌어?", KNOWN)] == ["000660"]
    assert [s[0] for s in ask.find_stocks("nvda랑 삼성전자 비교해줘", KNOWN)] == ["005930", "NVDA"]
    assert ask.find_stocks("오늘 시장 어때?", KNOWN) == []
    assert ask.find_stocks("전자", KNOWN) == []  # 너무 짧은 일부는 안 맞춰요


def test_parse_and_render():
    a, b = ask.parse('{"answer": "반도체가  빠졌어요 <약세>", "basis": ["- 외국인 −1,840억", "", "a", "b", "c"]}')
    assert a == "반도체가 빠졌어요 <약세>" and b == ["외국인 −1,840억", "a", "b"]
    text = ask.render(a, b)
    assert "🤖 반도체가 빠졌어요 &lt;약세&gt;" in text and "📌 <b>근거</b>\n• 외국인 −1,840억" in text and text.endswith("참고용</i>")
    assert ask.parse("그냥 글로 답했어요") == ("그냥 글로 답했어요", [])


def test_question_only_plain_text_from_owner():
    upd = lambda chat, text: {"message": {"chat": {"id": chat}, "text": text}}
    assert bot.question(upd(123, "하이닉스 왜 빠졌어?"), "123") == "하이닉스 왜 빠졌어?"
    assert bot.question(upd(123, "/잔고"), "123") is None
    assert bot.question(upd(123, "잔고"), "123") is None
    assert bot.question(upd(999, "하이닉스"), "123") is None


def test_follow_up_keeps_previous_stock(monkeypatch):
    saved = {}
    monkeypatch.setattr("app.ask.db.get_setting", lambda conn, key: saved.get(key))
    monkeypatch.setattr("app.ask.db.set_setting", lambda conn, key, v: saved.__setitem__(key, v))
    monkeypatch.setattr("app.ask.db.known_stocks", lambda conn: KNOWN)
    monkeypatch.setattr("app.ask.db.command_holdings", lambda conn: [])
    monkeypatch.setattr("app.ask.db.index_moves", lambda conn: {})
    asked = []
    monkeypatch.setattr("app.ask.stock_facts", lambda conn, t, n, m: (asked.append(t), {"ticker": t})[1])
    prompts = []

    def asker(system, prompt):
        prompts.append(prompt)
        return '{"answer": "답이에요", "basis": ["근거"]}'

    ask.answer(None, "하이닉스 왜 빠졌어?", asker, NOW)
    ask.answer(None, "그럼 더 빠질까?", asker, NOW + timedelta(minutes=5))
    assert asked == ["000660", "000660"]
    assert "[앞 대화]\nQ: 하이닉스 왜 빠졌어?\nA: 답이에요" in prompts[1]
    # 30분이 지나면 잊어요
    ask.answer(None, "그럼 더 빠질까?", asker, NOW + timedelta(hours=1))
    assert len(asked) == 2 and "[앞 대화]" not in prompts[2]
