import json
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app import ai
from app.ai_job import AiJob, target_day
from app.config import Config


def test_build_prompt_includes_journal_and_skips_missing():
    text = ai.build_prompt({
        "ticker": "IONQ", "name": "아이온큐", "market": "US",
        "holding": {"quantity": 40, "avg_price": 38.2, "cur_price": 46, "pnl_pct": 20.4},
        "journal": {"reason": "양자 컴퓨팅 성장", "scenario": "", "risks": ["적자", "희석", ""], "stop_price": 30, "target_price": 60},
        "price": {"종가": 46, "RSI(14)": None}, "earnings": [], "events": ["2026-10-23 실적 발표"], "news": ["10-19 IonQ 신규 계약"],
    })
    assert "매수 이유: 양자 컴퓨팅 성장" in text and "위험 요소: 적자, 희석" in text
    assert "시나리오" not in text and "RSI" not in text and "최근 실적" not in text
    assert "- 10-19 IonQ 신규 계약" in text


def test_build_prompt_lists_this_weeks_macro_events():
    text = ai.build_prompt({"ticker": "IONQ", "name": "아이온큐", "market": "US",
                            "macro": ["2026-10-28 FOMC 금리 결정 한국 시간 다음 날 03:00"]})
    assert "이번 주 시장 일정: 2026-10-28 FOMC 금리 결정" in text
    assert "이번 주 시장 일정" not in ai.build_prompt({"ticker": "IONQ", "name": "아이온큐", "market": "US"})


def test_build_prompt_without_journal():
    assert "매매일지 기록 없음" in ai.build_prompt({"ticker": "005930", "name": "삼성전자", "market": "KR"})


def test_parse_handles_wrapped_json_and_bad_tone():
    c = ai.parse('```json\n{"tone": "몰라", "comment": "손절가까지 여유가 있어요."}\n```')
    assert c == ai.Comment("중립", "손절가까지 여유가 있어요.")
    with pytest.raises(ValueError):
        ai.parse("없음")


def test_ask_sends_key_header_and_model():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["key"] = req.headers["x-api-key"]
        seen["model"] = json.loads(req.content)["model"]
        return httpx.Response(200, json={"content": [{"type": "text", "text": '{"tone": "주의", "comment": "목표가에 가까워요."}'}]})

    c = ai.ask("p", "sk-test", "claude-haiku-5-5", httpx.Client(transport=httpx.MockTransport(handler)))
    assert c.tone == "주의" and seen == {"key": "sk-test", "model": "claude-haiku-5-5"}


def test_ask_error_does_not_include_key():
    def handler(req):
        return httpx.Response(401, json={"error": {"message": "invalid x-api-key"}})

    with pytest.raises(RuntimeError) as e:
        ai.ask("p", "sk-secret", "m", httpx.Client(transport=httpx.MockTransport(handler)))
    assert "sk-secret" not in str(e.value)


def test_target_day_after_close_only():
    assert target_day("KR", datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)) is None  # 15:00 KST
    assert target_day("KR", datetime(2026, 10, 20, 7, 30, tzinfo=timezone.utc)) == date(2026, 10, 20)
    assert target_day("KR", datetime(2026, 10, 18, 9, 0, tzinfo=timezone.utc)) is None  # 일요일


def cfg(key="k", gemini=""):
    return Config(database_url="", kiwoom_appkey="", kiwoom_secretkey="", kiwoom_mock=True, telegram_bot_token="",
                  telegram_chat_id="", poll_seconds=60, anthropic_api_key=key, gemini_api_key=gemini)


def test_ask_gemini_uses_header_key_and_skips_thoughts():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["key"] = str(req.url), req.headers["x-goog-api-key"]
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [
            {"text": "생각 중", "thought": True}, {"text": '{"tone": "긍정", "comment": "계획대로 가고 있어요."}'}]}}]})

    c = ai.ask_gemini("p", "g-key", "gemini-flash-latest", httpx.Client(transport=httpx.MockTransport(handler)))
    assert c == ai.Comment("긍정", "계획대로 가고 있어요.")
    assert seen["url"].endswith("/models/gemini-flash-latest:generateContent") and "g-key" not in seen["url"]
    assert seen["key"] == "g-key"


def test_job_prefers_free_gemini_key():
    job = AiJob(cfg(key="paid", gemini="free"), None)
    assert (job.key, job.model, job.ask) == ("free", ai.DEFAULT_GEMINI_MODEL, ai.ask_gemini)
    assert AiJob(cfg(), None).ask is ai.ask


def test_job_writes_once_per_day_and_first_time_immediately(monkeypatch):
    saved = []
    done = {"IONQ": date(2026, 10, 19)}
    monkeypatch.setattr("app.ai_job.db.held_stocks", lambda conn: [("IONQ", "아이온큐", "US"), ("005930", "삼성전자", "KR")])
    monkeypatch.setattr("app.ai_job.db.ai_comment_days", lambda conn: done)
    monkeypatch.setattr("app.ai_job.db.ai_context", lambda conn, t, n, m: {"ticker": t, "name": n, "market": m})
    monkeypatch.setattr("app.ai_job.db.save_ai_comment", lambda conn, t, d, tone, body, model: saved.append((t, d)))
    monkeypatch.setattr("app.ai_job.ai.ask", lambda p, k, m, h: ai.Comment("중립", "ok"))
    now = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)  # 12:00 KST, 미국은 전날 밤
    AiJob(cfg(), None).run(None, now)
    assert saved == [("005930", date(2026, 10, 20))]  # IONQ는 오늘 미국 장이 아직 안 끝남
    saved.clear()
    AiJob(cfg(""), None).run(None, now)
    assert saved == []


def test_ask_gemini_falls_back_when_model_is_busy():
    tried = []

    def handler(req: httpx.Request) -> httpx.Response:
        model = req.url.path.split("/")[-1].split(":")[0]
        tried.append(model)
        if model == "gemini-flash-latest":
            return httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"tone": "중립", "comment": "ok"}'}]}}]})

    c = ai.ask_gemini("p", "k", "gemini-flash-latest", httpx.Client(transport=httpx.MockTransport(handler)))
    assert c.body == "ok" and tried == ["gemini-flash-latest", ai.GEMINI_FALLBACKS[0]]


def test_ask_gemini_gives_up_after_all_models_busy():
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(503)))
    with pytest.raises(RuntimeError, match="붐비"):
        ai.ask_gemini("p", "k", "gemini-flash-latest", client)


def test_job_waits_before_retrying_a_failed_stock(monkeypatch):
    calls = []
    monkeypatch.setattr("app.ai_job.db.held_stocks", lambda conn: [("IONQ", "아이온큐", "US")])
    monkeypatch.setattr("app.ai_job.db.ai_comment_days", lambda conn: {})
    monkeypatch.setattr("app.ai_job.db.ai_context", lambda conn, t, n, m: {"ticker": t, "name": n, "market": m})

    def busy(p, k, m, h):
        calls.append(1)
        raise RuntimeError("503")

    monkeypatch.setattr("app.ai_job.ai.ask", busy)
    job = AiJob(cfg(), None)
    now = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)
    job.run(None, now)
    job.run(None, now + timedelta(minutes=1))
    assert len(calls) == 1
    job.run(None, now + timedelta(minutes=21))
    assert len(calls) == 2


def test_gemini_forces_json_only_when_asked():
    import httpx
    from app.ai import gemini_text

    sent = []

    def handler(request):
        import json as j
        sent.append(j.loads(request.content)["generationConfig"])
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "AAPL|좋아요"}]}, "finishReason": "STOP"}]})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    assert gemini_text("티커|문장 줄로 답해", "p", "k", "m", http, 400) == "AAPL|좋아요"
    gemini_text('JSON 하나만 출력해: {"a": 1}', "p", "k", "m", http, 400)
    assert "responseMimeType" not in sent[0] and sent[1]["responseMimeType"] == "application/json"
    assert sent[0]["maxOutputTokens"] >= 4096


def test_gemini_search_turns_on_google_search_and_returns_sources():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"candidates": [{
            "content": {"parts": [{"text": "생각", "thought": True}, {"text": '{"one": "a"}'}]},
            "groundingMetadata": {"groundingChunks": [{"web": {"uri": "https://n.com/a", "title": "n.com"}}]},
        }]})

    text, sources = ai._gemini_search("JSON 하나만", "p", "k", "m", httpx.Client(transport=httpx.MockTransport(handler)), 100)
    assert text == '{"one": "a"}' and sources == [{"title": "n.com", "url": "https://n.com/a"}]
    assert seen["body"]["tools"] == [{"google_search": {}}] and "responseMimeType" not in seen["body"]["generationConfig"]


def test_claude_search_collects_result_links():
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["tools"][0]["name"] == "web_search"
        return httpx.Response(200, json={"content": [
            {"type": "server_tool_use"}, {"type": "web_search_tool_result", "content": [{"type": "web_search_result", "url": "https://a.com", "title": "A"}]},
            {"type": "text", "text": '{"one": "b"}'},
        ]})

    text, sources = ai._claude_search("s", "p", "k", "m", httpx.Client(transport=httpx.MockTransport(handler)), 100)
    assert text == '{"one": "b"}' and sources == [{"title": "A", "url": "https://a.com"}]


def test_gemini_moves_to_faster_model_when_one_times_out():
    seen = []

    def handler(request):
        seen.append((request.url.path.rsplit("/", 1)[-1], request.extensions["timeout"]["read"]))
        if len(seen) == 1:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "답"}]}, "finishReason": "STOP"}]})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    assert ai.gemini_text("s", "p", "k", "slow-model", http, 4096) == "답"
    assert seen[0] == ("slow-model:generateContent", 240) and seen[1][0] == "gemini-2.5-flash:generateContent"
    seen.clear()
    assert ai._gemini_search("s", "p", "k", "slow-model", http, 4096) == ("답", [])
    assert len(seen) == 2


def test_long_answers_never_fall_back_to_lite_models():
    assert ai.gemini_chain("gemini-flash-latest", 4096) == ("gemini-flash-latest", "gemini-2.5-flash")
    assert "gemini-flash-lite-latest" in ai.gemini_chain("gemini-flash-latest", 400)
    assert ai.gemini_chain("gemini-flash-lite-latest", 4096)[0] == "gemini-flash-lite-latest"
