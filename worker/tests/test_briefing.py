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
    assert text.splitlines()[0] == "🗓️ 내일 일정 · 10.28 (수)"
    assert "🏦 FOMC 금리 결정\n      미국 동부 14:00" in text
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


def test_morning_due_monday_to_saturday_mornings():
    assert briefing.morning_due(datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc)) == date(2026, 10, 20)  # 화 08:00
    assert briefing.morning_due(datetime(2026, 10, 20, 2, 0, tzinfo=timezone.utc)) is None  # 화 11:00
    assert briefing.morning_due(datetime(2026, 10, 23, 23, 30, tzinfo=timezone.utc)) == date(2026, 10, 24)  # 토 08:30
    assert briefing.morning_due(datetime(2026, 10, 24, 23, 30, tzinfo=timezone.utc)) is None  # 일 08:30


def test_morning_message_sections():
    text = briefing.morning_message(
        date(2026, 10, 20),
        [briefing.Quote("나스닥", 21400.5, -0.21), briefing.Quote("원/달러", 1338.2, -0.3)],
        [briefing.Holding("삼성전자", "KR", 68400, 1.2, 5.0), briefing.Holding("아이온큐", "US", 31.11, None, -17.66)],
        [],
    )
    assert text.startswith("☀️ <b>좋은 아침이에요</b> · 10.20 (화)")
    assert "<pre>나스닥  🔵  -0.2%\n원/달러 🔵  -0.3%  1,338원</pre>" in text
    # 미국 카드가 없으면 미국 종목도 표에 같이
    assert "💼 <b>내 종목</b>" in text and "아이온큐 ⚪      -  평단 -17.7%" in text
    assert "삼성전자 🔴  +1.2%  평단 +5.0%" in text
    # 이름은 이스케이프 전에 맞춰서 S&P 500도 줄이 안 밀려요
    t2 = briefing.morning_message(date(2026, 10, 20), [briefing.Quote("S&P 500", 1, 0.1), briefing.Quote("나스닥", 1, 0.1)], [], [])
    assert "<pre>S&amp;P 500 🔴" in t2 and "\n나스닥  🔴" in t2
    assert text.endswith("🗓️ <b>오늘 일정</b>\n큰 일정은 없어요 😌")
    assert "AI 한마디는 참고용" not in text


def test_morning_message_us_cards():
    us = [
        briefing.UsStock("SOUN", "사운드하운드", 100, 9.88, 10.12, 9.98, "3분기 실적 발표일 <11.6> 확정", None),
        briefing.UsStock("IONQ", "아이온큐", 10, 31.42, 29.61, 29.59, None, "관심이 이어질 수 있어요 & 흔들림도"),
    ]
    text = briefing.morning_message(date(2026, 10, 22), [], [briefing.Holding("삼성전자", "KR", 68400, -0.4, 3.0),
                                    briefing.Holding("아이온큐", "US", 31.42, None, 6.2)], [], us, 1338.2, 1342.2)
    assert "💵 <b>밤사이 내 미국 주식</b>" in text
    # 많이 움직인 아이온큐가 먼저, 뉴스·AI는 이스케이프
    assert text.index("아이온큐</b>") < text.index("사운드하운드</b>")
    assert "🔴 <b>아이온큐</b>   <b>+6.1%</b>\n<i>$31.42 · 평단 +6.2% · +2만원</i>\n🤖 관심이 이어질 수 있어요 &amp; 흔들림도" in text
    assert "📰 3분기 실적 발표일 &lt;11.6&gt; 확정" in text
    assert "💼 <b>국내 종목</b>" in text and "아이온큐    ⚪" not in text
    assert text.endswith(briefing.AI_NOTE)


def test_us_total_splits_price_and_fx():
    s = [briefing.UsStock("A", "A", 10, 110, 100, 90)]
    t = briefing.us_total(s, 1300, 1400)
    assert t.won == 10 * (110 * 1300 - 100 * 1400)
    assert t.fx_effect == 10 * 110 * (1300 - 1400) and t.value == 10 * 110 * 1300
    assert round(t.pct, 2) == round(t.won / (10 * 100 * 1400) * 100, 2)
    assert briefing.us_total(s, None, None) is None
    assert briefing.stock_won(briefing.UsStock("B", "B", 1, 5, None, 5), 1300, 1300) is None


def test_width_and_ai_parse():
    assert briefing.width("SK하이닉스") == 2 + 4 * 2 and briefing.pad("나스닥", 8) == "나스닥  "
    got = briefing.parse_us_ai("IONQ|좋아요\n- NVDA | 기대가 커요\n잡담\nXXX|무시", ["IONQ", "NVDA"])
    assert got == {"IONQ": "좋아요", "NVDA": "기대가 커요"}


def test_morning_sends_even_when_an_index_fails(monkeypatch):
    sent, marked = [], set()
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: key in marked)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: marked.add(key))
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_holdings", lambda conn: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_us", lambda conn: [("IONQ", "아이온큐", 10.0, 29.6, 31.4)])
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http, html=False: sent.append((text, html)))

    def daily(symbol, http, span):
        raise RuntimeError("blocked")

    monkeypatch.setattr("app.briefing_job.prices.yahoo_daily", daily)
    job = BriefingJob(cfg(), None)
    now = datetime(2026, 10, 19, 23, 5, tzinfo=timezone.utc)
    job.run(None, now)
    job.run(None, now)
    assert len(sent) == 1 and "morning:2026-10-20" in marked and "밤사이 미국장" not in sent[0][0] and sent[0][1]


def test_morning_us_cards_with_ai(monkeypatch):
    sent = []
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: False)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: None)
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_holdings", lambda conn: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_us", lambda conn: [("IONQ", "아이온큐", 10.0, 29.6, 31.4)])
    monkeypatch.setattr("app.briefing_job.db.news_since", lambda conn, t, since: ["IBM과 협력"])
    monkeypatch.setattr("app.briefing_job.db.us_exchange_rate", lambda conn: 1340.0)
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http, html=False: sent.append(text))

    class Bar:
        def __init__(self, c):
            self.close = c

    monkeypatch.setattr("app.briefing_job.prices.yahoo_daily", lambda s, http, span: [Bar(29.6), Bar(31.4)] if s == "IONQ" else [])
    job = BriefingJob(cfg(), None)
    asked = []
    job.ask = lambda system, prompt, key, model, http, n: asked.append(prompt) or "IONQ|관심이 이어질 수 있어요"
    job.run(None, datetime(2026, 10, 19, 23, 5, tzinfo=timezone.utc))
    assert "IONQ (아이온큐): 밤사이 +6.1%" in asked[0] and "IBM과 협력" in asked[0]
    assert "📰 IBM과 협력\n🤖 관심이 이어질 수 있어요" in sent[0] and "평가액 42만원" in sent[0]


def test_earnings_eve_message():
    e = briefing.EarningsEve("아이온큐", "US", "장 마감 후 · 예상 EPS -0.25", 5.0, 12.4, 38.5, 55.0, 18.2)
    text = briefing.earnings_eve_message(date(2026, 10, 28), e)
    assert text.splitlines()[:2] == ["📣 내일 실적 발표 · 아이온큐", "🗓️ 10.28 (수) · 장 마감 후 · 예상 EPS -0.25"]
    assert "👍 지난번 실적은 예상보다 +18% 좋았어요" in text and "🔴 지금 평단 대비 +5.0% · 내 돈의 12%" in text
    assert "🛑 손절 $38.50 · 🎯 익절 $55.00" in text
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
    assert b.bought and not b.skipped
    # '일지 안 씀'을 누른 단타는 매수가 전부 넘겨졌으니 일기장·알림에서 빠져요. 하나라도 남기면 그대로예요.
    from dataclasses import replace
    buy, sell = _t("2025-03-02", "buy", 1, 100), _t("2025-03-02", "sell", 1, 110)
    [joke] = closed_books([replace(buy, skipped=True), sell], {})
    [kept] = closed_books([replace(buy, skipped=True), _t("2025-03-02", "buy", 1, 100), _t("2025-03-03", "sell", 2, 110)], {})
    assert joke.skipped and not kept.skipped


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
    assert reviews[0].splitlines()[:3] == ["📕 다 팔았어요 · SK하이닉스", "🗓️ 10.01 → 10.14 · 13일", "🔴 수익률 +20.0% (+200원)"]
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
    assert lines[:5] == ["📊 이번 주 성적표", "🗓️ 10.19 (월) ~ 10.25 (일)", "", "💰 내 돈 1억 2,345만원", "🔴 지난주보다 +1.2% (+145만원)"]
    assert "🔴 SK하이닉스 +6.1%" in lines and "🔵 아이온큐 -3.2%" in lines
    assert "🔁 이번 주 매매 · 매수 3번 · 매도 2번" in lines and "🔴 판 것 손익(국내) +32만원" in lines and "🔵 판 것 손익(미국) -$12.50" in lines
    assert "📕 다 판 종목 · SK하이닉스 +35.2%" in lines and "✍️ 사후강평 안 쓴 일기장 2권" in lines
    assert lines[-3:] == ["🏦 10.28 (수) FOMC 금리 결정", "", "한 주 수고 많으셨어요 🙌"]
    empty = briefing.weekly_message(briefing.Week(date(2026, 10, 19), 5_000_000, None, [], 0, 0, {}, [], 0, []))
    assert "지난주 기록이 없어서 다음 주부터 비교해 드려요" in empty and "이번 주 매매 · 없었어요" in empty and "다음 주 일정 · 큰 일정은 없어요" in empty


def test_week_moves_counts_new_buys_from_buy_price():
    start, end = date(2026, 10, 19), date(2026, 10, 25)
    nok = [_t("2026-10-23", "buy", 10, 6.0, ticker="NOK")]
    nok = [type(t)("US", *[getattr(t, f) for f in ("ticker", "name", "day", "time", "side", "quantity", "price", "fee")]) for t in nok]
    old = [_t("2026-09-01", "buy", 5, 100), _t("2026-10-21", "buy", 5, 120)]  # 지난주부터 들고 있다가 이번 주에 더 산 종목
    rows = [("노키아 ADR", "US", "NOK", False, 10, 5.94, 6.6), ("SK하이닉스", "KR", "000660", False, 10, 110, 100),
            ("SK하이닉스 (ISA)", "KR", "000660", True, 3, 110, 100), ("새 종목", "KR", "005930", False, 1, None, None)]
    moves = briefing.week_moves(rows, nok + old, start, end)
    assert [(n, round(p, 1), d) for n, p, d in moves] == [
        ("노키아 ADR", -1.0, date(2026, 10, 23)), ("SK하이닉스", 10.0, None), ("SK하이닉스 (ISA)", 10.0, None)]
    w = briefing.Week(start, None, None, moves, 0, 0, {}, [], 0, [])
    assert "🔵 노키아 ADR -1.0% (금요일에 산 뒤)" in briefing.weekly_message(w).splitlines()


def test_week_moves_counts_rebuy_after_selling_all():
    start, end = date(2026, 10, 19), date(2026, 10, 25)
    trades = [_t("2026-10-19", "buy", 10, 100), _t("2026-10-20", "sell", 10, 110), _t("2026-10-22", "buy", 10, 90)]
    [(n, p, d)] = briefing.week_moves([("SK하이닉스", "KR", "000660", False, 10, 95, 80)], trades, start, end)
    assert round(p, 1) == 5.6 and d == date(2026, 10, 22)
    # 지난주부터 들고 있다가 일부만 팔고 다시 산 건 지난주 종가에서부터 셈해요.
    old = [_t("2026-10-01", "buy", 10, 100), _t("2026-10-20", "sell", 5, 110), _t("2026-10-22", "buy", 5, 90)]
    assert briefing.week_moves([("SK하이닉스", "KR", "000660", False, 10, 95, 80)], old, start, end)[0][2] is None


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
    assert "매수 0번 · 매도 2번" in w and "판 것 손익(국내) +15원" in w and "다 판 종목 · SK하이닉스 +0.5%" in w
    assert "weekly:2026-10-19" in marked


def test_term_at_bottom_and_rotation(monkeypatch):
    from app import terms
    text = briefing.morning_message(date(2026, 10, 22), [], [], [], term=terms.message(None, 1))
    assert text.endswith("📚 <b>오늘의 용어 · PER</b>\n" + terms.TERMS[1].meaning)  # 예시를 못 만들면 풀이만
    assert briefing.LINE in text
    assert terms.next_index(None, lambda conn, key: len(terms.TERMS) + 2) == 2
    assert terms.next_index(None, lambda conn, key: None) == 0


def test_saturday_morning_says_friday():
    q = briefing.Quote("S&P 500", 6000.0, 0.5)
    h = briefing.Holding("삼성전자", "KR", 70000.0, 1.2, 3.4)
    text = briefing.morning_message(date(2026, 10, 24), [q], [h], [])
    assert "금요일 밤 미국장" in text and "(금요일 마감)" in text
    assert "밤사이" not in briefing.morning_message(date(2026, 10, 24), [q], [], [])
    # 월요일 아침의 미국장은 토요일에 이미 보낸 금요일 장이에요.
    mon = briefing.morning_message(date(2026, 10, 26), [q], [h], [], repeat=date(2026, 10, 23))
    assert "🌙 <b>금요일 미국장</b> <i>(토요일에 보낸 것과 같아요)</i>" in mon and "밤사이" not in mon
    assert "밤사이 미국장" in briefing.morning_message(date(2026, 10, 27), [q], [h], [])
    # 금요일이 한국 휴장(한글날)이면 '금요일 마감'이라고 하지 않아요.
    assert "(금요일 마감)" not in briefing.morning_message(date(2026, 10, 10), [q], [h], [])


def test_no_saturday_morning_after_us_holiday_friday():
    assert briefing.morning_due(datetime(2026, 12, 25, 23, 30, tzinfo=timezone.utc)) is None  # 토 12.26, 금 크리스마스
    assert briefing.morning_due(datetime(2027, 3, 26, 23, 30, tzinfo=timezone.utc)) is None  # 토 3.27, 금 성금요일
    assert briefing.morning_due(datetime(2026, 10, 9, 23, 30, tzinfo=timezone.utc)) == date(2026, 10, 10)  # 한국만 휴장


def test_monday_morning_marks_friday_session_as_repeat(monkeypatch):
    sent, settings = [], {}
    monkeypatch.setattr("app.briefing_job.db.notice_sent", lambda conn, key: False)
    monkeypatch.setattr("app.briefing_job.db.mark_notice", lambda conn, key: None)
    monkeypatch.setattr("app.briefing_job.db.events_on", lambda conn, day: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_holdings", lambda conn: [])
    monkeypatch.setattr("app.briefing_job.db.briefing_us", lambda conn: [])
    monkeypatch.setattr("app.briefing_job.db.get_setting", lambda conn, key: settings.get(key))
    monkeypatch.setattr("app.briefing_job.db.set_setting", lambda conn, key, v: settings.__setitem__(key, v))
    monkeypatch.setattr("app.briefing_job.telegram.send", lambda token, chat, text, http, html=False: sent.append(text))

    class Bar:
        def __init__(self, d, c):
            self.day, self.close = d, c

    bars = [Bar(date(2026, 10, 22), 100.0), Bar(date(2026, 10, 23), 101.0)]
    monkeypatch.setattr("app.briefing_job.prices.yahoo_daily", lambda s, http, span: bars)
    job = BriefingJob(cfg(), None)
    job.run(None, datetime(2026, 10, 23, 23, 5, tzinfo=timezone.utc))  # 토
    assert "금요일 밤 미국장" in sent[-1] and settings["briefing_us_day"] == "2026-10-23"
    job.run(None, datetime(2026, 10, 25, 23, 5, tzinfo=timezone.utc))  # 월
    assert "금요일 미국장</b> <i>(토요일에 보낸 것과 같아요)</i>" in sent[-1] and "밤사이" not in sent[-1]
    bars.append(Bar(date(2026, 10, 26), 102.0))
    job.run(None, datetime(2026, 10, 26, 23, 5, tzinfo=timezone.utc))  # 화
    assert "밤사이 미국장" in sent[-1] and settings["briefing_us_day"] == "2026-10-26"
