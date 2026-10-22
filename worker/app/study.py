"""관심종목 › 기업 공부.

- 🎲 AI 추천: 요즘 흐름이 좋은 큰 종목 중 몇 개를 무작위로 뽑아 AI가 하나를 고르고, 왜 골랐는지와 먼저 볼 것을 적어요.
- AI 초안: 노트 칸(한 줄 요약, 돈 버는 구조, 강점, 틀릴 수 있는 이유 등)에 참고용 초안을 써요. 사용자가 보고 고쳐 써요.
- 다시 볼 날: 정해 둔 날이 되면 텔레그램으로 알려요.

화면이 버튼을 누르면 몇 초 안에 하도록 따로 도는 줄(start)과, 하루 한 번 알림(ReminderJob)이 있어요.
"""
import json
import logging
import random
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import ai, db, telegram
from .config import Config

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")
POLL_SECONDS = 4
TOP = 15  # 흐름 좋은 순으로 이만큼 추린 뒤
SAMPLE = 6  # 그중 무작위로 이만큼을 AI에게 보여 줘요
REMIND_HOUR = 9
VERDICT = {"buy": "산다", "wait": "기다린다", "pass": "안 산다"}


@dataclass(frozen=True)
class Candidate:
    ticker: str
    name: str
    market: str
    close: float
    r20: float
    r60: float
    from_high: float  # 1년 최고가 대비(%) 0이면 신고가
    themes: tuple[str, ...] = ()


def flow_of(ticker: str, name: str, market: str, closes: list[float]) -> Candidate | None:
    """흐름이 좋은지: 60일선 위에 있고 석 달 수익이 플러스. 일봉이 70개보다 적으면 못 봐요."""
    if len(closes) < 70:
        return None
    last = closes[-1]
    ma60 = sum(closes[-60:]) / 60
    r20 = (last / closes[-21] - 1) * 100
    r60 = (last / closes[-61] - 1) * 100
    high = max(closes[-252:])
    if last <= ma60 or r60 <= 0:
        return None
    return Candidate(ticker, name, market, last, round(r20, 1), round(r60, 1), round((last / high - 1) * 100, 1))


def score(c: Candidate) -> float:
    return c.r60 + c.r20 * 0.5 + (5 if c.from_high > -5 else 0)


def rank(cands: list[Candidate]) -> list[Candidate]:
    return sorted(cands, key=score, reverse=True)[:TOP]


def describe(c: Candidate) -> str:
    where = "1년 최고가 근처" if c.from_high > -5 else f"1년 최고가보다 {abs(c.from_high):.0f}% 아래"
    return f"한 달 {c.r20:+.0f}%, 석 달 {c.r60:+.0f}%, {where}"


PICK_SYSTEM = """너는 한국 개인투자자의 기업 공부를 돕는 도우미야. 요즘 주가 흐름이 좋은 후보 몇 개 중 공부해 볼 회사 하나를 골라.
매수 권유가 아니라 공부거리를 고르는 거야. "사세요", "오를 거예요" 같은 말은 절대 쓰지 마.
후보에 없는 종목은 고르지 마. 주어진 숫자를 바꾸거나 새 숫자를 지어내지 마.
쉬운 한국어 존댓말(~예요, ~어요)로 써.
JSON 하나만 출력해:
{"ticker": "고른 종목 코드", "why": ["왜 요즘 흐름이 좋은지 짐작되는 이유 (40자 안쪽)", ...최대 3개],
 "first": ["이 회사를 공부할 때 먼저 확인할 질문 (40자 안쪽)", ...3개],
 "peers": [{"ticker": "같은 업종 경쟁사 코드(국내 6자리, 미국 티커)", "name": "이름", "market": "KR 또는 US"}, ...최대 3개]}"""

STYLES = ("기술주", "성장주", "가치주", "배당주", "경기민감주", "경기방어주", "우량주", "턴어라운드", "테마주")

DRAFT_SYSTEM = """너는 한국 개인투자자의 기업 공부 노트를 대신 채워 주는 조사 도우미야.
웹 검색으로 사업보고서·실적 발표·IR 자료·믿을 만한 기사를 찾아보고, 아래 자료와 함께 노트 전체를 채워.
사용자가 나중에 확인할 수 있게, 확실하지 않은 건 "확인 필요"라고 붙여.
숫자는 자료나 검색 결과에서 확인한 것만 쓰고, 대략 아는 건 "약"을 붙여. 모르면 빈칸("")이나 빈 목록으로 둬.
"사세요", "파세요" 같은 매수·매도 권유는 절대 쓰지 마. 가격 생각은 PER·PBR 같은 근거로 "이 정도면 싸다고 볼 만하다" 수준으로만 써.
쉬운 한국어 존댓말(~예요, ~어요)로, 짧게 써.
마지막에 JSON 하나만 출력해(설명 글 없이):
{"sector": "업종 (예: 반도체, 2차전지, 인터넷, 은행)",
 "styles": ["주식 유형 1~3개, 다음 중에서만: 기술주, 성장주, 가치주, 배당주, 경기민감주, 경기방어주, 우량주, 턴어라운드, 테마주"],
 "one": "이 회사는 ___을 ___에게 팔아 돈을 번다 형식의 한 줄 (60자 안쪽)",
 "lines": [{"name": "사업 이름", "pct": 매출 비중 숫자}, ...최대 5개],
 "customers": "주요 고객 (40자 안쪽)",
 "power": "강함 또는 보통 또는 약함", "powerWhy": "가격을 올릴 힘이 그런 이유 (50자 안쪽)",
 "numbersNote": "최근 매출·이익·현금흐름 숫자를 보고 읽을 점 (100자 안쪽)",
 "moat": "경쟁사가 쉽게 못 따라 하는 이 회사만의 강점 (60자 안쪽)",
 "promises": [{"when": "2026.07 처럼 연.월", "said": "경영진이 최근 공개적으로 약속·제시한 목표"}, ...최대 3개],
 "events": [{"when": "언제(예: 2027년 1월 말)", "text": "주가에 중요한 앞으로의 일"}, ...최대 3개],
 "risks": [{"text": "이 회사에 투자하면 틀릴 수 있는 이유", "signal": "이게 보이면 다시 생각할 신호"}, ...3개],
 "cheap": 싸다고 볼 만한 주가 숫자 또는 null, "pricey": 비싸다고 볼 만한 주가 숫자 또는 null,
 "priceWhy": "그 가격의 근거 (예: 지난 5년 PER 8~15배, 지금 12배) (80자 안쪽)",
 "conclusion": "공부한 내용을 3~5줄로 정리. 좋은 점과 걱정되는 점을 같이 (250자 안쪽)",
 "questions": ["사용자가 스스로 더 확인해 볼 질문", ...3개]}"""


def _s(v, limit: int) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:limit]


def _json(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("AI 답에 JSON이 없어요")
    return json.loads(m.group(0))


def valid_ticker(ticker: str, market: str) -> bool:
    return bool(re.fullmatch(r"[0-9]{6}", ticker)) if market == "KR" else bool(re.fullmatch(r"[A-Z][A-Z.]{0,5}", ticker))


def pick_prompt(sample: list[Candidate], hot_themes: list[str]) -> str:
    lines = ["후보:"]
    for c in sample:
        theme = f", 테마: {', '.join(c.themes[:3])}" if c.themes else ""
        lines.append(f"- {c.ticker} {c.name} ({'국내' if c.market == 'KR' else '미국'}) {describe(c)}{theme}")
    if hot_themes:
        lines.append("요즘 국내에서 강한 테마: " + ", ".join(hot_themes))
    return "\n".join(lines)


def parse_pick(text: str, sample: list[Candidate]) -> tuple[Candidate, list[str], list[str], list[dict]]:
    data = _json(text)
    chosen = next((c for c in sample if c.ticker == str(data.get("ticker", "")).strip().upper()), None)
    if chosen is None:
        raise ValueError("AI가 후보에 없는 종목을 골랐어요")
    why = [_s(x, 80) for x in (data.get("why") or []) if _s(x, 80)][:3]
    first = [_s(x, 80) for x in (data.get("first") or []) if _s(x, 80)][:3]
    peers = []
    for p in data.get("peers") or []:
        if not isinstance(p, dict):
            continue
        t, m, n = str(p.get("ticker", "")).strip().upper(), str(p.get("market", "")).strip().upper(), _s(p.get("name"), 40)
        if m in ("KR", "US") and valid_ticker(t, m) and t != chosen.ticker and n:
            peers.append({"ticker": t, "name": n, "market": m})
    return chosen, why, first, peers[:3]


def fallback_pick(sample: list[Candidate], rand: random.Random) -> tuple[Candidate, list[str], list[str], list[dict]]:
    c = rand.choice(sample)
    return c, [f"{describe(c)}예요."], ["이 회사는 무엇을 팔아 돈을 버나요?", "최근 실적이 주가 흐름을 뒷받침하나요?", "경쟁사보다 나은 점은 뭔가요?"], []


def _price(v) -> float | None:
    try:
        n = float(str(v).replace(",", "").replace("$", "").replace("원", "").strip())
    except (TypeError, ValueError):
        return None
    return round(n, 2) if n > 0 else None


def parse_draft(text: str, sources: list[dict] | None = None) -> dict:
    d = _json(text)
    out: dict = {
        "sector": _s(d.get("sector"), 30),
        "styles": [x for x in dict.fromkeys(_s(v, 10) for v in d.get("styles") or []) if x in STYLES][:3],
        "one": _s(d.get("one"), 120), "customers": _s(d.get("customers"), 80),
        "power": d.get("power") if d.get("power") in ("강함", "보통", "약함") else "", "powerWhy": _s(d.get("powerWhy"), 100),
        "numbersNote": _s(d.get("numbersNote"), 200), "moat": _s(d.get("moat"), 120),
        "cheap": _price(d.get("cheap")), "pricey": _price(d.get("pricey")), "priceWhy": _s(d.get("priceWhy"), 160),
        "conclusion": str(d.get("conclusion") or "").strip()[:500],
    }
    lines = []
    for x in d.get("lines") or []:
        if isinstance(x, dict) and _s(x.get("name"), 30):
            try:
                pct = max(0.0, min(100.0, float(x.get("pct"))))
            except (TypeError, ValueError):
                pct = 0.0
            lines.append({"name": _s(x.get("name"), 30), "pct": round(pct)})
    out["lines"] = lines[:5]
    promises = d.get("promises")
    out["promises"] = [{"when": _s(x.get("when"), 20), "said": _s(x.get("said"), 120)}
                       for x in promises if isinstance(x, dict) and _s(x.get("said"), 120)][:3] if isinstance(promises, list) else []
    out["events"] = [{"when": _s(x.get("when"), 30), "text": _s(x.get("text"), 80)} for x in d.get("events") or [] if isinstance(x, dict) and _s(x.get("text"), 80)][:3]
    out["risks"] = [{"text": _s(x.get("text"), 80), "signal": _s(x.get("signal"), 80)} for x in d.get("risks") or [] if isinstance(x, dict) and _s(x.get("text"), 80)][:3]
    out["questions"] = [_s(x, 80) for x in d.get("questions") or [] if _s(x, 80)][:3]
    seen, out["sources"] = set(), []
    for x in sources or []:
        url = str(x.get("url") or "")
        if url.startswith(("http://", "https://")) and url not in seen:
            seen.add(url)
            out["sources"].append({"title": _s(x.get("title"), 80) or url[:80], "url": url[:500]})
    out["sources"] = out["sources"][:6]
    return out


def draft_prompt(name: str, market: str, ctx: dict) -> str:
    lines = [f"회사: {name} ({'국내' if market == 'KR' else '미국'})"]
    if ctx.get("pick"):
        lines.append("요즘 주가 흐름: " + " / ".join(ctx["pick"]))
    if ctx.get("price"):
        lines.append(f"지금 주가: {ctx['price']}")
    if ctx.get("sector"):
        lines.append(f"증권사 업종 분류: {ctx['sector']}")
    if ctx.get("money"):
        lines.append("최근 연간 실적: " + "; ".join(ctx["money"]))
    if ctx.get("cfo"):
        lines.append("영업현금흐름: " + "; ".join(ctx["cfo"]))
    if ctx.get("peers"):
        lines.append("사용자가 넣은 경쟁사: " + ", ".join(ctx["peers"]))
    if ctx.get("themes"):
        lines.append("속한 테마: " + ", ".join(ctx["themes"]))
    if ctx.get("news"):
        lines.append("최근 뉴스 제목:\n" + "\n".join(f"- {t}" for t in ctx["news"]))
    if ctx.get("filings"):
        lines.append("최근 공시:\n" + "\n".join(f"- {t}" for t in ctx["filings"]))
    if ctx.get("events"):
        lines.append("앱 일정에 잡힌 일: " + "; ".join(ctx["events"]))
    return "\n".join(lines)


class StudyWorker:
    def __init__(self, cfg: Config, http: httpx.Client, rand: random.Random | None = None):
        self.http = http
        self.key, self.model, self.ask = ai.text_asker(cfg)
        self.search = ai.search_asker(cfg)
        self.rand = rand or random.Random()

    def run_once(self, conn: psycopg.Connection) -> bool:
        req = db.get_setting(conn, "study_pick")
        if isinstance(req, dict) and req.get("status") == "pending":
            self.pick(conn, req)
            return True
        row = db.pending_study_draft(conn)
        if row:
            self.draft(conn, *row)
            return True
        return False

    def pick(self, conn: psycopg.Connection, req: dict) -> None:
        market = req.get("market") if req.get("market") in ("KR", "US") else None
        cands = []
        for ticker, name, mk, closes in db.study_universe(conn, market):
            c = flow_of(ticker, name, mk, closes)
            if c:
                cands.append(c)
        top = rank(cands)
        if not top:
            db.set_setting(conn, "study_pick", {**req, "status": "error", "error": "흐름을 볼 일봉이 아직 모자라요. 워커가 연습용 종목 일봉을 받는 중이에요."})
            return
        sample = self.rand.sample(top, min(SAMPLE, len(top)))
        themes = db.study_themes(conn, [c.ticker for c in sample])
        sample = [Candidate(**{**c.__dict__, "themes": tuple(themes.get(c.ticker, []))}) for c in sample]
        model = None
        if self.ask:
            try:
                chosen, why, first, peers = parse_pick(self.ask(PICK_SYSTEM, pick_prompt(sample, db.hot_themes(conn)), self.key, self.model, self.http, 1024), sample)
                model = self.model
            except Exception as e:
                log.warning("기업 공부 AI 추천 실패, 무작위로 골라요: %s", e)
                chosen, why, first, peers = fallback_pick(sample, self.rand)
        else:
            chosen, why, first, peers = fallback_pick(sample, self.rand)
        pick = {"why": why, "first": first, "flow": describe(chosen), "model": model, "at": datetime.now(timezone.utc).isoformat()}
        db.create_ai_study(conn, chosen.ticker, chosen.name, chosen.market, pick, peers, draft=bool(self.ask))
        db.set_setting(conn, "study_pick", {**req, "status": "done", "ticker": chosen.ticker})
        log.info("기업 공부 추천: %s", chosen.name)

    def draft(self, conn: psycopg.Connection, ticker: str, name: str, market: str, asked_at) -> None:
        if not self.ask:
            db.finish_study_draft(conn, ticker, None, "none", "AI 키가 없어요", asked_at)
            return
        try:
            prompt = draft_prompt(name, market, db.study_context(conn, ticker, market))
            out = None
            if self.search:
                try:
                    out = parse_draft(*self.search(DRAFT_SYSTEM, prompt, self.key, self.model, self.http, 4096))
                    out["searched"] = True
                except Exception as e:
                    log.warning("%s 기업 공부 검색 초안 실패, 검색 없이 다시 써요: %s", name, e)
            if out is None:
                out = parse_draft(self.ask(DRAFT_SYSTEM, prompt, self.key, self.model, self.http, 4096))
                out["searched"] = False
            out["model"] = self.model
            out["at"] = datetime.now(timezone.utc).isoformat()
            db.finish_study_draft(conn, ticker, out, "done", None, asked_at)
            log.info("%s 기업 공부 AI 초안을 썼습니다", name)
        except Exception as e:
            db.finish_study_draft(conn, ticker, None, "error", str(e)[:200], asked_at)
            log.warning("%s 기업 공부 AI 초안 실패: %s", name, e)


def loop(cfg: Config, db_conn) -> None:
    worker = StudyWorker(cfg, httpx.Client(timeout=60))
    while True:
        try:
            while worker.run_once(db_conn.get()):
                pass
        except Exception:
            log.exception("기업 공부 처리 실패")
            db_conn.check()
        time.sleep(POLL_SECONDS)


def start(cfg: Config, db_conn) -> None:
    threading.Thread(target=loop, args=(cfg, db_conn), name="study", daemon=True).start()


def reminder_text(rows: list[tuple]) -> str:
    """rows: (name, verdict, studied_on, price_then, price_now, market)"""
    out = ["📒 다시 볼 날이 된 기업 공부 노트", ""]
    for name, verdict, studied, then, now, market in rows:
        line = f"• {name}"
        if studied:
            line += f" · {studied:%Y.%m.%d}에 공부"
        if verdict in VERDICT:
            line += f" · 판단 {VERDICT[verdict]}"
        if then and now:
            pct = (float(now) / float(then) - 1) * 100
            mark = "🔴 " if pct > 0 else "🔵 " if pct < 0 else ""
            line += f"\n   그 뒤 주가 {mark}{pct:+.1f}%"
        out.append(line)
    out += ["", "생각이 바뀌었는지, 틀릴 수 있는 이유의 신호가 보이는지 노트를 다시 열어 보세요."]
    return "\n".join(out)


class ReminderJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.cfg = cfg
        self.http = http

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = (now or datetime.now(timezone.utc)).astimezone(KST)
        if now.hour < REMIND_HOUR or not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id):
            return
        today: date = now.date()
        rows = db.study_reminders(conn, today)
        if not rows:
            return
        if telegram.deliver(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, reminder_text([r[1:] for r in rows]), self.http):
            db.study_reminded(conn, [r[0] for r in rows], today)


