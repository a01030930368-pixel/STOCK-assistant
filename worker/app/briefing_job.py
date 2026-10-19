"""저녁 일정 알림을 하루 한 번만 보냅니다. 보낸 기록은 DB에 남겨 워커를 다시 켜도 두 번 가지 않습니다."""
import logging
from datetime import datetime, timezone

import httpx
import psycopg

from . import briefing, db, telegram
from .config import Config

log = logging.getLogger("worker")


class BriefingJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.cfg = cfg
        self.http = http

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        if not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id):
            return
        now = now or datetime.now(timezone.utc)
        day = briefing.evening_due(now)
        if day is None:
            return
        key = f"evening:{day.isoformat()}"
        if db.notice_sent(conn, key):
            return
        text = briefing.evening_message(day, [briefing.Item(*r) for r in db.events_on(conn, day)])
        if text:
            telegram.send(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, text, self.http)
            log.info("내일 일정 알림을 보냈습니다")
        db.mark_notice(conn, key)
