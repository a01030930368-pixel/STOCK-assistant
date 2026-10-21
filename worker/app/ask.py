"""텔레그램에 명령 없이 보낸 말에 AI가 답합니다. 앱 DB에 있는 내 보유·주가·수급·뉴스·공시·일정만 보여 주고,
답 2~3문장 뒤에 그 답을 받친 숫자를 📌 근거 3줄로 붙여요. 사라·팔라는 말은 하지 않아요.

바로 앞 대화 3번을 30분 동안 기억해서 "그럼 더 빠질까?" 같은 이어 묻기도 알아들어요."""
import html
import json
import re
from datetime import datetime, timedelta, timezone

import psycopg

from . import db

KEEP_TURNS = 3
FORGET_AFTER = timedelta(minutes=30)
MAX_STOCKS = 3
# 조사·어미를 떼고 종목 이름과 맞춰 봐요("하이닉스는" → "하이닉스").
JOSA = re.compile(r"(은|는|이|가|을|를|도|의|에|랑|이랑|하고|좀|요|야|아|에서|까지|부터|처럼|보다|만)$")

SYSTEM = """너는 한국 개인투자자의 텔레그램 비서야. 사용자의 질문에 아래 [자료]만 보고 답해.
규칙:
- 답은 쉬운 한국어 존댓말(~예요, ~어요)로 2~3문장. 이유를 먼저 말해.
- [자료]에 없는 숫자·사실은 지어내지 마. 모르면 "앱에 그 자료가 아직 없어요"라고 해.
- "사세요", "파세요", "지금이 기회" 같은 매수·매도 권유는 절대 하지 마. 앞으로 오를지 내릴지는 단정하지 마.
- basis에는 답을 받친 사실을 [자료]의 숫자 그대로 3개까지, 한 줄에 40자 안쪽으로.
JSON 하나만 출력해: {"answer": "답", "basis": ["근거1", "근거2", "근거3"]}"""


def _words(text: str) -> list[str]:
    out = []
    for w in re.split(r"[\s,.?!~()\"'·/]+", text or ""):
        w = w.strip()
        for _ in range(2):
            w = JOSA.sub("", w) if len(w) > 2 else w
        if len(w) >= 2:
            out.append(w)
    return out


def find_stocks(text: str, known: list[tuple[str, str, str]]) -> list[tuple[str, str, str]]:
    """질문에 나온 종목 (ticker, name, market). 티커("000660", "nvda")나 이름 일부("하이닉스")로 찾아요."""
    upper = (text or "").upper()
    words = _words(text)
    hits = []
    for t, name, market in known:
        tick = bool(re.search(rf"(?<![0-9A-Z]){re.escape(t.upper())}(?![0-9A-Z])", upper))
        named = any(w == name or (w in name and len(w) * 3 >= len(name) * 2) for w in words)
        if (tick or named) and t not in [h[0] for h in hits]:
            hits.append((t, name, market))
    return hits[:MAX_STOCKS]


def stock_facts(conn: psycopg.Connection, ticker: str, name: str, market: str) -> dict:
    ctx = db.ai_context(conn, ticker, name, market)
    closes = db.last_closes(conn, ticker, 2)
    if len(closes) == 2 and closes[0]:
        ctx.setdefault("price", {})["마지막 거래일 등락"] = f"{(closes[1] / closes[0] - 1) * 100:+.1f}%"
    if market == "KR":
        flows = db.recent_flows(conn, ticker, 5)
        if flows:
            ctx["수급(억원, 최근 5일)"] = [f"{d} 외국인 {f / 100:+,.0f} 기관 {i / 100:+,.0f} 개인 {p / 100:+,.0f}" for d, f, i, p in flows]
    filings = db.recent_filings(conn, ticker, 30)
    if filings:
        ctx["공시(30일)"] = [f"{d} {t}" for d, t in filings]
    return ctx


def build_prompt(question: str, stocks: list[dict], account: list[tuple], indexes: dict, history: list[dict], today: str) -> str:
    data = {"오늘": today, "내 보유 종목(이름, 시장, 현재가, 수익률%)": account, "지수 최근 등락": indexes, "질문한 종목": stocks}
    lines = ["[자료]", json.dumps(data, ensure_ascii=False, default=str)]
    if history:
        lines += ["", "[앞 대화]"] + [f"Q: {h['q']}\nA: {h['a']}" for h in history]
    lines += ["", f"[질문] {question}"]
    return "\n".join(lines)


def parse(text: str) -> tuple[str, list[str]]:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        # JSON을 안 지켰으면 글 전체를 답으로 써요.
        plain = re.sub(r"\s+", " ", text or "").strip()
        if not plain:
            raise ValueError("AI 답이 비었어요")
        return plain[:400], []
    data = json.loads(m.group(0))
    answer = re.sub(r"\s+", " ", str(data.get("answer") or "")).strip()
    if not answer:
        raise ValueError("AI 답이 비었어요")
    basis = [re.sub(r"\s+", " ", str(b)).strip(" -•*")[:60] for b in (data.get("basis") or []) if str(b).strip()]
    return answer[:400], basis[:3]


def render(answer: str, basis: list[str]) -> str:
    e = lambda t: html.escape(t, quote=False)
    out = [f"🤖 {e(answer)}"]
    if basis:
        out += ["", "📌 <b>근거</b>"] + [f"• {e(b)}" for b in basis]
    out += ["", "<i>앱에 있는 자료로 답했어요 · 참고용</i>"]
    return "\n".join(out)


def recent(history: dict | None, now: datetime) -> list[dict]:
    if not history or not history.get("at"):
        return []
    if now - datetime.fromisoformat(history["at"]) > FORGET_AFTER:
        return []
    return history.get("turns", [])[-KEEP_TURNS:]


def answer(conn: psycopg.Connection, question: str, asker, now: datetime | None = None) -> str:
    """asker(system, prompt) -> 글. 답할 HTML 글을 돌려줘요."""
    now = now or datetime.now(timezone.utc)
    turns = recent(db.get_setting(conn, "ask_history"), now)
    known = db.known_stocks(conn)
    found = find_stocks(question, known)
    if not found and turns:
        # 이어 묻기: 앞 대화에서 말한 종목을 그대로 써요.
        prev = set(turns[-1].get("tickers", []))
        found = [k for k in known if k[0] in prev]
    stocks = [stock_facts(conn, *s) for s in found]
    prompt = build_prompt(question, stocks, db.command_holdings(conn), db.index_moves(conn),
                          [{"q": t["q"], "a": t["a"]} for t in turns], now.astimezone(timezone(timedelta(hours=9))).date().isoformat())
    text, basis = parse(asker(SYSTEM, prompt))
    turns = (turns + [{"q": question[:200], "a": text, "tickers": [s[0] for s in found]}])[-KEEP_TURNS:]
    db.set_setting(conn, "ask_history", {"at": now.isoformat(), "turns": turns})
    return render(text, basis)
