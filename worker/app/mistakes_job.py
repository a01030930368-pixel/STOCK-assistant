"""실수 노트 일정. 한 주에 한 번, 또는 화면에서 '다시 읽기'를 누르면 최근 6개월 기록을 AI가 다시 읽습니다."""
import dataclasses
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import ai, books, db, mistakes
from .config import Config

log = logging.getLogger("worker")

EVERY = timedelta(days=7)
RETRY_AFTER = timedelta(minutes=30)
SPAN_DAYS = 183


class MistakesJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.http = http
        self.key, self.model, self.ask = ai.text_asker(cfg)
        self.failed_at: datetime | None = None

    def due(self, conn: psycopg.Connection, now: datetime) -> bool:
        last = db.get_setting(conn, "mistakes") or {}
        asked = db.get_setting(conn, "mistakes_request")
        at = datetime.fromisoformat(last["at"]) if last.get("at") else None
        if asked and (at is None or datetime.fromisoformat(asked) > at):
            return True  # 화면에서 다시 읽기를 눌렀어요(실패 뒤 쉬는 중이어도 바로)
        if self.failed_at and now - self.failed_at < RETRY_AFTER:
            return False
        return at is None or now - at >= EVERY

    def items(self, conn: psycopg.Connection, now: datetime) -> list[mistakes.Item]:
        since = now.astimezone(timezone.utc).date() - timedelta(days=SPAN_DAYS)
        trades, held, _ = db.review_inputs(conn)
        closed = {b.key: b for b in books.closed_books(trades, held)}
        out = []
        for r in db.mistake_sells(conn, since):
            item = mistakes.sell_item(r)
            if len(r) >= 14:
                # 이 매도가 들어 있는 일기장 권을 찾아 같은 매매로 묶어요.
                market, ticker = r[12], r[13]
                book = next((b for b in closed.values() if b.market == market and b.ticker == ticker
                             and (b.start is None or b.start <= item.day) and item.day <= b.end), None)
                if book:
                    item = dataclasses.replace(item, trade=book.key)
            out.append(item)
        for n, (key, *row) in enumerate(db.mistake_reviews(conn), 1):
            b = closed.get(key)
            end = b.end if b else datetime.strptime(key.split(":")[2][:10], "%Y-%m-%d").date()
            if end < since:
                continue
            out.append(mistakes.review_item(n, key, b.name if b else key.split(":")[1], end, b.return_pct if b else None, row))
        return sorted(out, key=lambda i: i.day)

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if not self.key:
            # 키가 없는데 화면에서 다시 읽기를 눌렀으면 '읽는 중'에 멈추지 않게 이유를 남기고 요청을 내려놔요.
            if db.get_setting(conn, "mistakes_request"):
                db.set_setting(conn, "mistakes_status", {"at": now.isoformat(), "error": "AI 키가 없어요 (.env의 GEMINI_API_KEY)"})
                db.set_setting(conn, "mistakes_request", None)
            return
        if not self.due(conn, now):
            return
        items = self.items(conn, now)
        if len(items) < mistakes.MIN_ITEMS:
            db.set_setting(conn, "mistakes", {"at": now.isoformat(), "few": len(items)})
            return
        try:
            raw = mistakes.parse(self.ask(mistakes.SYSTEM, mistakes.build_prompt(items), self.key, self.model, self.http, 4096))
            result = mistakes.assemble(raw, items)
        except Exception as e:
            self.failed_at = now
            db.set_setting(conn, "mistakes_status", {"at": now.isoformat(), "error": str(e)[:200]})
            # 다시 읽기 요청은 한 번 실패하면 내려놓고, 30분 뒤 일정에 맡겨요.
            db.set_setting(conn, "mistakes_request", None)
            log.warning("실수 노트 만들기 실패: %s", e)
            return
        self.failed_at = None
        db.set_setting(conn, "mistakes", {"at": now.isoformat(), "model": self.model, **result})
        db.set_setting(conn, "mistakes_status", {"at": now.isoformat(), "error": None})
        log.info("실수 노트를 새로 썼습니다 (기록 %d개, 실수 %d개)", len(items), len(result["mistakes"]))
