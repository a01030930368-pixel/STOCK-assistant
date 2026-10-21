from datetime import date, datetime, timezone
from decimal import Decimal

from app import disclosures, macro
from app.disclosure_job import DisclosureJob
from app.disclosures import Disclosure, classify

NOW = datetime(2026, 10, 21, 5, tzinfo=timezone.utc)  # 14:00 KST


def test_classify_important_and_quiet_kinds():
    assert classify("주요사항보고서(유상증자결정)").key == "rights"
    assert classify("[기재정정]단일판매ㆍ공급계약체결").key == "contract"
    assert classify("연결재무제표기준영업(잠정)실적(공정공시)").key == "earnings"
    assert classify("주요사항보고서(전환사채권발행결정)").key == "cb"
    assert classify("주식등의대량보유상황보고서(일반)").important is False
    assert classify("임원ㆍ주요주주특정증권등소유상황보고서").important is False
    assert classify("기업설명회(IR)개최(안내공시)").key == "other"


def test_message():
    d = Disclosure("20261021000123", "247540", "에코프로비엠", "주요사항보고서(유상증자결정)", "에코프로비엠", date(2026, 10, 21))
    assert disclosures.message(d) == (
        "⚠️ 에코프로비엠 · 유상증자 공시\n\n📄 주요사항보고서(유상증자결정)\n"
        "회사가 새 주식을 팔아 돈을 모아요. 주식 수가 늘어 주가가 흔들릴 수 있어요.\n\n"
        "🔗 https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261021000123")


def test_message_marks_watchlist_stocks():
    d = Disclosure("9", "035420", "NAVER", "현금ㆍ현물배당결정", "", date(2026, 10, 21))
    assert disclosures.message(d, held=False).startswith("💰 NAVER · 배당 공시 · ⭐ 관심종목\n\n📄 현금ㆍ현물배당결정")


class Cfg:
    dart_api_key = "k"
    telegram_bot_token = "t"
    telegram_chat_id = "c"


def test_job_seeds_quietly_then_alerts_new_important_once(monkeypatch):
    settings, notices, saved, sent = {}, set(), [], []
    monkeypatch.setattr("app.db.get_setting", lambda conn, k: settings.get(k))
    monkeypatch.setattr("app.db.set_setting", lambda conn, k, v: settings.__setitem__(k, v))
    monkeypatch.setattr("app.db.notice_sent", lambda conn, k: k in notices)
    monkeypatch.setattr("app.db.mark_notice", lambda conn, k: notices.add(k))
    monkeypatch.setattr("app.db.save_disclosures", lambda conn, rows: saved.extend(rows))
    monkeypatch.setattr("app.db.disclosure_stocks", lambda conn: [("000660", "SK하이닉스", True), ("069500", "KODEX 200", True)])
    monkeypatch.setattr("app.telegram.deliver", lambda token, chat, text, http: sent.append(text) or True)
    listing = [Disclosure("1", "000660", "SK하이닉스", "단일판매ㆍ공급계약체결", "", date(2026, 10, 20))]
    calls = []
    monkeypatch.setattr("app.disclosures.fetch", lambda t, n, corp, key, since, today, http: calls.append((t, since)) or list(listing))
    job = DisclosureJob(Cfg(), None, lambda: {"000660": "00164779"})

    job.run(object(), NOW)  # 처음엔 한 달 치를 채우기만 해요
    assert calls == [("000660", date(2026, 9, 21))] and sent == [] and settings["disclosure_seeded"] == ["000660"]

    listing += [Disclosure("2", "000660", "SK하이닉스", "주요사항보고서(유상증자결정)", "", date(2026, 10, 21)),
                Disclosure("3", "000660", "SK하이닉스", "임원ㆍ주요주주특정증권등소유상황보고서", "", date(2026, 10, 21)),
                Disclosure("4", "000660", "SK하이닉스", "현금ㆍ현물배당결정", "", date(2026, 10, 10))]
    job.run(object(), NOW.replace(minute=5))  # 10분이 안 지나 건너뛰어요
    assert len(calls) == 1
    job.run(object(), NOW.replace(minute=11))
    assert calls[-1] == ("000660", date(2026, 10, 18))
    assert len(sent) == 1 and sent[0].startswith("⚠️ SK하이닉스 · 유상증자")  # 지분 공시·옛 배당 공시는 안 보내요
    job.run(object(), NOW.replace(minute=22))
    assert len(sent) == 1


def test_usdkrw_days_reads_in_one_year_chunks():
    seen = []

    class Res:
        def __init__(self, url): self.url = url
        def raise_for_status(self): pass
        def json(self):
            start = self.url.split("/")[-3]
            return {"StatisticSearch": {"row": [{"TIME": start, "DATA_VALUE": "1,342.5"}]}}

    class Http:
        def get(self, url):
            seen.append(url)
            return Res(url)

    rows = macro.fetch_usdkrw_days("k", date(2025, 1, 1), date(2026, 3, 1), Http())
    assert len(seen) == 2 and "/1/400/731Y001/D/20250101/20260101/" in seen[0]
    assert rows[0] == (date(2025, 1, 1), Decimal("1342.5"))
