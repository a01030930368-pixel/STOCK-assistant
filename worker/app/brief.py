"""매수 전 한 장 요약. 화면이 계산한 6칸(실적·수급·차트 위치·값어치·소식·조심할 점)을 받아
AI가 한 줄 결론과 좋은 점·걱정되는 점을 씁니다. 숫자와 신호등 색은 화면 계산 그대로 두고, AI는 문장만 써요."""
import json
import logging
import re
import threading
import time

import httpx

from . import ai, db
from .config import Config

log = logging.getLogger("worker")

POLL_SECONDS = 5
MAX_ITEMS = 4
SIGNAL = {"g": "좋음", "y": "보통·주의", "r": "조심", "n": "자료 없음"}

SYSTEM = """너는 한국 개인투자자가 주식을 사기 전에 보는 '한 장 요약'을 쓰는 도우미야.
주어진 항목의 사실만 써. 새 숫자를 만들거나 바꾸지 마.
"사세요", "파세요", "지금이 기회" 같은 매수·매도 권유는 절대 쓰지 마.
쉬운 한국어 존댓말(~예요, ~어요)로 써.
JSON 하나만 출력해: {"one": "한 줄 결론(60자 안쪽)", "good": ["좋은 점", ...], "bad": ["걱정되는 점", ...]}
good·bad는 각각 최대 4개, 한 개에 40자 안쪽. 해당하는 게 없으면 빈 목록."""


def build_prompt(name: str, market: str, cells: list[dict]) -> str:
    lines = [f"종목: {name} ({'국내' if market == 'KR' else '미국'})"]
    for c in cells:
        lines.append(f"- {c.get('title')} [{SIGNAL.get(c.get('signal'), '')}]: {c.get('text')}")
    return "\n".join(lines)


def _clean(items, limit: int = 60) -> list[str]:
    out = []
    for x in items if isinstance(items, list) else []:
        s = re.sub(r"\s+", " ", str(x)).strip(" -•*")
        if s:
            out.append(s[:limit])
    return out[:MAX_ITEMS]


def parse(text: str) -> tuple[str | None, list[str], list[str]]:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("AI 답에 JSON이 없어요")
    data = json.loads(m.group(0))
    one = re.sub(r"\s+", " ", str(data.get("one") or "")).strip()[:100] or None
    return one, _clean(data.get("good")), _clean(data.get("bad"))


def fallback(cells: list[dict]) -> tuple[list[str], list[str]]:
    """AI가 없거나 실패하면 신호등 색으로 나눠요: 초록은 좋은 점, 노랑·빨강은 걱정되는 점."""
    good = [f"{c['title']}: {c['text']}" for c in cells if c.get("signal") == "g"]
    bad = [f"{c['title']}: {c['text']}" for c in cells if c.get("signal") in ("y", "r")]
    return good[:MAX_ITEMS], bad[:MAX_ITEMS]


class BriefWriter:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.http = http
        self.key, self.model, self.ask = ai.text_asker(cfg)

    def run_once(self, conn) -> bool:
        row = db.pending_brief(conn)
        if not row:
            return False
        ticker, name, market, cells, made_at = row
        cells = cells if isinstance(cells, list) else []
        if not self.ask:
            good, bad = fallback(cells)
            db.finish_brief(conn, ticker, None, good, bad, None, None, made_at=made_at)
            return True
        try:
            one, good, bad = parse(self.ask(SYSTEM, build_prompt(name, market, cells), self.key, self.model, self.http, 1024))
            db.finish_brief(conn, ticker, one, good, bad, self.model, None, made_at=made_at)
            log.info("%s 한 장 요약을 썼습니다", name)
        except Exception as e:
            good, bad = fallback(cells)
            db.finish_brief(conn, ticker, None, good, bad, self.model, str(e)[:200], made_at=made_at)
            log.warning("%s 한 장 요약 AI 실패: %s", name, e)
        return True


def brief_loop(cfg: Config, db_conn) -> None:
    """화면에서 버튼을 누르면 몇 초 안에 쓰도록 따로 도는 줄. db_conn은 main.Connection(끊기면 다시 붙는 연결)."""
    writer = BriefWriter(cfg, httpx.Client(timeout=60))
    while True:
        try:
            while writer.run_once(db_conn.get()):
                pass
        except Exception:
            log.exception("한 장 요약 실패")
            db_conn.check()
        time.sleep(POLL_SECONDS)


def start(cfg: Config, db_conn) -> None:
    threading.Thread(target=brief_loop, args=(cfg, db_conn), name="brief", daemon=True).start()
