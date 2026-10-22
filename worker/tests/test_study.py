import json
import random
from datetime import date, datetime, timezone
from unittest import mock

from app import study

UP = [100 + i * 0.5 for i in range(120)]  # 꾸준히 오르는 차트
DOWN = [200 - i * 0.5 for i in range(120)]


def test_flow_keeps_only_rising_stocks_above_ma60():
    c = study.flow_of("000660", "SK하이닉스", "KR", UP)
    assert c and c.r60 > 0 and c.r20 > 0 and c.from_high == 0
    assert study.flow_of("X", "x", "US", DOWN) is None
    assert study.flow_of("X", "x", "US", UP[:50]) is None  # 일봉이 모자라요


def test_rank_puts_stronger_trend_first():
    slow = study.flow_of("A", "a", "US", [100 + i * 0.1 for i in range(120)])
    fast = study.flow_of("B", "b", "US", UP)
    assert [c.ticker for c in study.rank([slow, fast])] == ["B", "A"]


def cand(t):
    return study.Candidate(t, t + " Inc", "US", 10, 5, 20, -2)


def test_parse_pick_rejects_tickers_outside_sample_and_cleans_peers():
    sample = [cand("NVDA"), cand("AMD")]
    text = json.dumps({"ticker": "amd", "why": ["AI 서버 수요", ""], "first": ["데이터센터 매출 비중은?"],
                       "peers": [{"ticker": "NVDA", "name": "NVIDIA", "market": "US"}, {"ticker": "12", "name": "x", "market": "KR"},
                                 {"ticker": "AMD", "name": "self", "market": "US"}]})
    chosen, why, first, peers = study.parse_pick(text, sample)
    assert chosen.ticker == "AMD" and why == ["AI 서버 수요"] and first == ["데이터센터 매출 비중은?"]
    assert peers == [{"ticker": "NVDA", "name": "NVIDIA", "market": "US"}]
    try:
        study.parse_pick(json.dumps({"ticker": "TSLA"}), sample)
        assert False
    except ValueError:
        pass


def test_parse_draft_clamps_and_drops_bad_items():
    d = study.parse_draft("```json\n" + json.dumps({
        "one": "메모리를 만들어 서버 회사에 팔아요", "power": "아주 강함", "lines": [{"name": "D램", "pct": 130}, {"name": "", "pct": 3}, {"name": "낸드", "pct": "x"}],
        "risks": [{"text": "메모리 값 하락", "signal": "고정가 2달 하락"}, {"text": ""}], "events": "없음", "questions": ["누가 사 가나요?"],
    }) + "\n```")
    assert d["one"].startswith("메모리") and d["power"] == ""
    assert d["lines"] == [{"name": "D램", "pct": 100}, {"name": "낸드", "pct": 0}]
    assert d["risks"] == [{"text": "메모리 값 하락", "signal": "고정가 2달 하락"}] and d["events"] == []


def test_pick_without_ai_chooses_from_top_and_creates_note():
    cfg = mock.Mock(gemini_api_key="", anthropic_api_key="")
    w = study.StudyWorker(cfg, mock.Mock(), random.Random(1))
    with mock.patch.object(study, "db") as db:
        db.study_universe.return_value = [("AAA", "Aaa", "US", UP), ("BBB", "Bbb", "US", DOWN)]
        db.study_themes.return_value = {}
        w.pick(mock.Mock(), {"id": "r1", "market": "US", "status": "pending"})
    db.study_universe.assert_called_with(mock.ANY, "US")
    args = db.create_ai_study.call_args.args
    assert args[1:4] == ("AAA", "Aaa", "US") and args[4]["flow"].startswith("한 달") and db.create_ai_study.call_args.kwargs == {"draft": False}
    assert db.set_setting.call_args.args[2] == {"id": "r1", "market": "US", "status": "done", "ticker": "AAA"}


def test_pick_reports_when_no_candidates():
    w = study.StudyWorker(mock.Mock(gemini_api_key="", anthropic_api_key=""), mock.Mock())
    with mock.patch.object(study, "db") as db:
        db.study_universe.return_value = []
        w.pick(mock.Mock(), {"id": "r", "market": "ALL", "status": "pending"})
    db.study_universe.assert_called_with(mock.ANY, None)
    assert db.set_setting.call_args.args[2]["status"] == "error"
    db.create_ai_study.assert_not_called()


def test_draft_saves_ai_answer_or_error():
    w = study.StudyWorker(mock.Mock(gemini_api_key="", anthropic_api_key=""), mock.Mock())
    w.ask, w.key, w.model = mock.Mock(return_value='{"one": "한 줄"}'), "k", "m"
    with mock.patch.object(study, "db") as db:
        db.study_context.return_value = {"news": ["HBM 증설"]}
        w.draft(mock.Mock(), "000660", "SK하이닉스", "KR", "t0")
        assert "HBM 증설" in w.ask.call_args.args[1]
        ticker, out, status, err, asked = db.finish_study_draft.call_args.args[1:]
        assert (ticker, status, err, asked) == ("000660", "done", None, "t0") and out["one"] == "한 줄" and out["model"] == "m"
        w.ask.side_effect = RuntimeError("busy")
        w.draft(mock.Mock(), "000660", "SK하이닉스", "KR", "t1")
        assert db.finish_study_draft.call_args.args[3:] == ("error", "busy", "t1")


def test_reminder_sends_once_after_9_kst():
    cfg = mock.Mock(telegram_bot_token="t", telegram_chat_id="c")
    job = study.ReminderJob(cfg, mock.Mock())
    rows = [("000660", "SK하이닉스", "wait", date(2026, 7, 20), 200000, 236000, "KR")]
    with mock.patch.object(study, "db") as db, mock.patch.object(study.telegram, "deliver", return_value=True) as deliver:
        db.study_reminders.return_value = rows
        job.run(mock.Mock(), datetime(2026, 10, 22, 23, tzinfo=timezone.utc))  # 07시 KST: 아직
        deliver.assert_not_called()
        job.run(mock.Mock(), datetime(2026, 10, 23, 1, tzinfo=timezone.utc))  # 10시 KST
    text = deliver.call_args.args[2]
    assert "SK하이닉스" in text and "판단 기다린다" in text and "+18.0%" in text
    db.study_reminded.assert_called_with(mock.ANY, ["000660"], date(2026, 10, 23))


def test_parse_draft_fills_whole_note_and_keeps_web_sources():
    d = study.parse_draft(json.dumps({
        "sector": "반도체", "styles": ["기술주", "성장주", "주식", "기술주"], "numbersNote": "이익과 현금이 같이 늘어요",
        "promises": [{"when": "2026.07", "said": "HBM4 하반기 양산"}, {"said": ""}], "cheap": "180,000", "pricey": -3,
        "priceWhy": "PER 8배", "conclusion": "좋은 점\n걱정되는 점",
    }), [{"title": "IR 자료", "url": "https://example.com/ir"}, {"title": "x", "url": "javascript:1"}, {"title": "dup", "url": "https://example.com/ir"}])
    assert d["sector"] == "반도체" and d["styles"] == ["기술주", "성장주"]
    assert d["promises"] == [{"when": "2026.07", "said": "HBM4 하반기 양산"}]
    assert d["cheap"] == 180000 and d["pricey"] is None and d["conclusion"] == "좋은 점\n걱정되는 점"
    assert d["sources"] == [{"title": "IR 자료", "url": "https://example.com/ir"}]
    assert study.parse_draft('{"promises": "실적 발표 자료"}')["promises"] == []


def test_draft_uses_web_search_and_falls_back_without_it():
    w = study.StudyWorker(mock.Mock(gemini_api_key="", anthropic_api_key=""), mock.Mock())
    w.ask, w.key, w.model = mock.Mock(return_value='{"one": "검색 없이"}'), "k", "m"
    w.search = mock.Mock(return_value=('```json\n{"one": "검색함"}\n```', [{"title": "기사", "url": "https://n.com/a"}]))
    with mock.patch.object(study, "db") as db:
        db.study_context.return_value = {"price": "236,000원"}
        w.draft(mock.Mock(), "000660", "SK하이닉스", "KR", "t0")
        out = db.finish_study_draft.call_args.args[2]
        assert out["one"] == "검색함" and out["searched"] and out["sources"][0]["url"] == "https://n.com/a"
        assert "지금 주가: 236,000원" in w.search.call_args.args[1]
        w.ask.assert_not_called()
        w.search.side_effect = RuntimeError("400")
        w.draft(mock.Mock(), "000660", "SK하이닉스", "KR", "t1")
        out = db.finish_study_draft.call_args.args[2]
        assert out["one"] == "검색 없이" and out["searched"] is False


def test_compare_writes_ai_line_or_error():
    w = study.StudyWorker(mock.Mock(gemini_api_key="", anthropic_api_key=""), mock.Mock())
    w.ask, w.key, w.model = mock.Mock(return_value="  하이닉스가 이익률이 더 높아요.\n마이크론은 성장이 빨라요. "), "k", "m"
    req = {"id": "c1", "sector": "반도체", "tickers": ["000660", "MU"], "status": "pending"}
    with mock.patch.object(study, "db") as db:
        db.get_setting.side_effect = lambda conn, key: req if key == "study_compare" else None
        db.pending_study_draft.return_value = None
        db.study_compare_context.return_value = [{"name": "SK하이닉스", "one": "메모리", "margin": "35%"}, {"name": "Micron", "growth": "+31%"}]
        assert w.run_once(mock.Mock())
        saved = db.set_setting.call_args.args[2]
        assert saved["status"] == "done" and saved["text"] == "하이닉스가 이익률이 더 높아요. 마이크론은 성장이 빨라요."
        assert "영업이익률 35%" in w.ask.call_args.args[1] and "업종: 반도체" in w.ask.call_args.args[1]
        db.study_compare_context.return_value = [{"name": "x"}]
        w.compare(mock.Mock(), req)
        assert db.set_setting.call_args.args[2]["status"] == "error"


def test_fresh_pick_skips_sectors_already_studied_and_tells_ai():
    cfg = mock.Mock(gemini_api_key="", anthropic_api_key="")
    w = study.StudyWorker(cfg, mock.Mock(), random.Random(3))
    w.ask, w.key, w.model = mock.Mock(return_value='{"ticker": "KO", "why": ["처음 보는 음료 회사예요"]}'), "k", "m"
    up = lambda k: [100 + i * k for i in range(120)]
    with mock.patch.object(study, "db") as db:
        db.study_universe.return_value = [("MU", "Micron", "US", up(0.9)), ("KO", "Coca-Cola", "US", up(0.2)), ("JPM", "JPMorgan", "US", up(0.3)), ("XOM", "Exxon", "US", up(0.25))]
        db.study_themes.return_value = {}
        db.hot_themes.return_value = []
        db.study_coverage.return_value = {"sectors": {"반도체": 2}, "styles": {"기술주": 2}}
        db.sectors_of.return_value = {"MU": "반도체", "KO": "음료"}
        w.pick(mock.Mock(), {"id": "r", "market": "US", "status": "pending", "fresh": True})
    system, prompt = w.ask.call_args.args[:2]
    assert "아직 안 해 본 쪽" in system and "MU" not in prompt
    assert "이미 공부한 업종: 반도체 2곳" in prompt and "배당주" in prompt and "업종: 음료" in prompt
    assert db.create_ai_study.call_args.args[1] == "KO" and db.create_ai_study.call_args.args[4]["fresh"] is True


def test_fresh_pool_keeps_everything_when_too_few_left():
    cs = [cand("A"), cand("B"), cand("C")]
    assert study.fresh_pool(cs, {"A": "반도체"}, {"반도체"}) == cs
    assert [c.ticker for c in study.fresh_pool(cs + [cand("D")], {"A": "반도체"}, {"반도체"})] == ["B", "C", "D"]


def test_parse_draft_keeps_peers_but_not_itself():
    d = study.parse_draft(json.dumps({"peers": [
        {"ticker": "ERIC", "name": "에릭슨", "market": "US"}, {"ticker": "nok", "name": "노키아", "market": "US"},
        {"ticker": "CSCO", "name": "시스코", "market": "US"}, {"ticker": "ERIC", "name": "에릭슨", "market": "US"}]}), own="NOK")
    assert [p["ticker"] for p in d["peers"]] == ["ERIC", "CSCO"]
    assert study.parse_draft("{}")["peers"] == []
