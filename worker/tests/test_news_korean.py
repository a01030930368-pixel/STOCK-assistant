from datetime import datetime, timezone
from types import SimpleNamespace

import httpx

from app import db, research
from app.research_job import ResearchJob


def translator(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=[[[f"[ko]{request.url.params['q']}", request.url.params["q"], None]], None, "en"])


def test_translate_fills_title_and_summary(monkeypatch):
    rows = [
        ("IONQ", "https://x/1", "IonQ jumps", None, "Shares rose.", None),
        ("IONQ", "https://x/2", "아이온큐 급등", None, "", None),
        ("IONQ", "https://x/3", "Old title", "옛 제목", "New summary", None),
    ]
    saved = []
    monkeypatch.setattr(db, "untranslated_news", lambda conn: rows)
    monkeypatch.setattr(db, "save_korean", lambda conn, *a: saved.append(a))
    job = ResearchJob(SimpleNamespace(), httpx.Client(transport=httpx.MockTransport(translator)))
    job._translate(None)
    assert saved == [
        ("IONQ", "https://x/1", "[ko]IonQ jumps", "[ko]Shares rose."),
        ("IONQ", "https://x/2", "아이온큐 급등", None),
        ("IONQ", "https://x/3", "옛 제목", "[ko]New summary"),
    ]


def test_translate_stops_when_blocked(monkeypatch):
    monkeypatch.setattr(db, "untranslated_news", lambda conn: [("A", "u", "Hello", None, "", None)])
    monkeypatch.setattr(db, "save_korean", lambda conn, *a: (_ for _ in ()).throw(AssertionError("저장하면 안 돼요")))
    job = ResearchJob(SimpleNamespace(), httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429))))
    job._translate(None)


def test_us_stock_also_gets_korean_articles(monkeypatch):
    calls = []
    monkeypatch.setattr(db, "watched_stocks", lambda conn: [("IONQ", "아이온큐", "US"), ("PLTR", "PLTR", "US")])
    monkeypatch.setattr(db, "save_news", lambda conn, items: None)
    monkeypatch.setattr(research, "finnhub_news", lambda t, *a: calls.append(("finnhub", t)) or [])
    monkeypatch.setattr(research, "google_news", lambda t, name, http: calls.append(("google", name)) or [])
    job = ResearchJob(SimpleNamespace(naver_client_id="", naver_client_secret="", finnhub_api_key="k"), httpx.Client())
    monkeypatch.setattr(job, "_translate", lambda conn: None)
    job._news(None, datetime(2026, 10, 20, tzinfo=timezone.utc))
    # 한글 이름이 없는 종목은 국내 기사를 찾지 않아요.
    assert calls == [("finnhub", "IONQ"), ("google", "아이온큐"), ("finnhub", "PLTR")]


def test_stale_prices_are_refetched_and_retried_after_an_hour(monkeypatch):
    from datetime import timedelta
    from app import prices
    got, saved = [], []
    monkeypatch.setattr(db, "unpriced_stocks", lambda conn: [("INTC", "인텔", "US")])
    monkeypatch.setattr(db, "save_prices", lambda conn, t, rows: saved.append(t))
    monkeypatch.setattr(prices, "us_daily", lambda t, http: got.append(t) or [])
    job = ResearchJob(SimpleNamespace(), httpx.Client())
    t0 = datetime(2026, 11, 2, 3, tzinfo=timezone.utc)
    job._new_prices(None, t0)
    job._new_prices(None, t0 + timedelta(minutes=30))
    assert got == ["INTC"]
    job._new_prices(None, t0 + timedelta(hours=1))
    assert got == ["INTC", "INTC"] and saved == ["INTC", "INTC"]
