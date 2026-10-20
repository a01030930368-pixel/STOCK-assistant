"""ISA 계좌 체결을 30분마다 받아 올해 산 금액(납입 한도 확인)을 셉니다. 처음 한 번은 올해 1월 1일부터 받습니다."""
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from . import db, fills

log = logging.getLogger("worker")

EVERY = timedelta(minutes=30)
RECENT_DAYS = 10
KST = ZoneInfo("Asia/Seoul")
YEAR_KEY = "isa_fills_year"


class IsaJob:
    def __init__(self, kiwoom=None):
        self.kiwoom = kiwoom
        self.last: datetime | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if not self.kiwoom or (self.last and now - self.last < EVERY):
            return
        self.last = now
        today = now.astimezone(KST).date()
        # 해가 바뀌거나 처음이면 1월 1일부터, 그 뒤로는 최근 열흘만 받습니다.
        start = today - timedelta(days=RECENT_DAYS) if db.get_setting(conn, YEAR_KEY) == today.year else date(today.year, 1, 1)
        try:
            rows = []
            for a, b in fills.chunks(start, today):
                rows += self.kiwoom.kr_fills(a, b)
            merged = fills.group(rows)
            db.save_isa_fills(conn, merged)
            db.set_setting(conn, YEAR_KEY, today.year)
            db.set_setting(conn, "isa_status", {"at": now.isoformat(), "ok": True, "count": len(merged)})
            log.info("ISA 체결 내역 확인: %d건", len(merged))
        except Exception as e:
            log.warning("ISA 체결 내역 가져오기 실패: %s", e)
            db.set_setting(conn, "isa_status", {"at": now.isoformat(), "ok": False, "error": str(e)[:200]})
