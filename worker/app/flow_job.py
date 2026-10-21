"""국내 수급과 테마 동향을 모아요.

수급: 보유·관심 국내 종목마다 처음 한 번, 그 뒤로는 장 마감 뒤 하루 한 번(새 종목은 바로).
테마: 장중 10분, 장이 닫혀 있으면 3시간마다 전체 테마를. 내 종목이 든 테마는 하루 한 번.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from . import db
from .market import kr_market_open

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")

THEME_OPEN_EVERY = timedelta(minutes=10)
THEME_CLOSED_EVERY = timedelta(hours=3)
MEMBER_EVERY = timedelta(days=1)


class FlowJob:
    def __init__(self, kiwoom=None):
        self.kiwoom = kiwoom
        self.flow_done: dict[str, str] = {}  # 종목 → 받은 날:장중/마감
        self.theme_at: datetime | None = None
        self.was_open = False
        self.member_at: dict[str, datetime] = {}

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        if not self.kiwoom:
            return
        now = now or datetime.now(timezone.utc)
        open_now = kr_market_open(now)
        just_closed = self.was_open and not open_now
        self.was_open = open_now
        targets = db.flow_targets(conn)
        self._flows(conn, now, open_now, targets)
        every = THEME_OPEN_EVERY if open_now else THEME_CLOSED_EVERY
        if self.theme_at is None or just_closed or now - self.theme_at >= every:
            self.theme_at = now
            self._themes(conn, now, targets)

    def _flows(self, conn: psycopg.Connection, now: datetime, open_now: bool, targets) -> None:
        kst = now.astimezone(KST)
        stamp = f"{kst.date()}:{'open' if open_now else 'closed'}"
        error = None
        for ticker, name in targets:
            last = self.flow_done.get(ticker)
            # 장중에는 처음 보는 종목만, 마감 뒤에는 그날 아직 마감 값을 안 받은 종목만
            if last and (open_now or last == stamp):
                continue
            try:
                db.save_flows(conn, ticker, self.kiwoom.investor_flows(ticker, kst.strftime("%Y%m%d")))
            except Exception as e:
                log.warning("%s 수급 받기 실패: %s", name, e)
                error = str(e)[:200]
            self.flow_done[ticker] = stamp
        if targets:
            db.set_setting(conn, "flow_status", {"at": now.isoformat(), "ok": error is None, **({"error": error} if error else {})})

    def _themes(self, conn: psycopg.Connection, now: datetime, targets) -> None:
        try:
            db.save_themes(conn, self.kiwoom.themes())
            db.set_setting(conn, "theme_status", {"at": now.isoformat(), "ok": True})
        except Exception as e:
            log.warning("테마 동향 갱신 실패: %s", e)
            db.set_setting(conn, "theme_status", {"at": now.isoformat(), "ok": False, "error": str(e)[:200]})
            return
        for ticker, name in targets:
            last = self.member_at.get(ticker)
            if last and now - last < MEMBER_EVERY:
                continue
            self.member_at[ticker] = now
            try:
                db.save_stock_themes(conn, ticker, self.kiwoom.themes(ticker))
            except Exception as e:
                log.warning("%s 테마 받기 실패: %s", name, e)
