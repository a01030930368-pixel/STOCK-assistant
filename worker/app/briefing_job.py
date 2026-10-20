"""저녁 일정 알림과 아침 브리핑을 하루 한 번씩만 보냅니다. 보낸 기록은 DB에 남겨 워커를 다시 켜도 두 번 가지 않습니다."""
import logging
from datetime import datetime, timezone

import httpx
import psycopg

from . import briefing, db, prices, telegram
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
        self._evening(conn, now)
        self._morning(conn, now)

    def _send(self, text: str) -> None:
        telegram.send(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, text, self.http)

    def _evening(self, conn: psycopg.Connection, now: datetime) -> None:
        day = briefing.evening_due(now)
        if day is None:
            return
        key = f"evening:{day.isoformat()}"
        if db.notice_sent(conn, key):
            return
        text = briefing.evening_message(day, [briefing.Item(*r) for r in db.events_on(conn, day)])
        if text:
            self._send(text)
            log.info("내일 일정 알림을 보냈습니다")
        db.mark_notice(conn, key)

    def _morning(self, conn: psycopg.Connection, now: datetime) -> None:
        day = briefing.morning_due(now)
        if day is None:
            return
        key = f"morning:{day.isoformat()}"
        if db.notice_sent(conn, key):
            return
        holdings = [briefing.Holding(*r) for r in db.briefing_holdings(conn)]
        items = [briefing.Item(*r) for r in db.events_on(conn, day)]
        self._send(briefing.morning_message(day, self._indexes(), holdings, items))
        log.info("아침 브리핑을 보냈습니다")
        db.mark_notice(conn, key)

    def _indexes(self) -> list[briefing.Quote]:
        # 지수 하나가 막혀도 나머지와 브리핑은 그대로 보냅니다.
        out = []
        for symbol, name in briefing.INDEXES:
            try:
                bars = prices.yahoo_daily(symbol, self.http, span="5d")
            except Exception as e:
                log.warning("%s 지수 가져오기 실패: %s", name, e)
                continue
            if bars:
                last, prev = float(bars[-1].close), float(bars[-2].close) if len(bars) > 1 else None
                out.append(briefing.Quote(name, last, (last / prev - 1) * 100 if prev else None))
        return out
