"""키움 체결 내역을 30분마다 받아 매매일지에 안 적은 체결을 찾게 합니다. 처음 한 번은 최근 3개월을 받습니다."""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from . import db, fills

log = logging.getLogger("worker")

EVERY = timedelta(minutes=30)
BACKFILL_DAYS = 92
RECENT_DAYS = 10
KST = ZoneInfo("Asia/Seoul")


class FillsJob:
    def __init__(self, kiwoom=None):
        self.kiwoom = kiwoom
        self.last: datetime | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if not self.kiwoom or (self.last and now - self.last < EVERY):
            return
        self.last = now
        today = now.astimezone(KST).date()
        done = db.get_setting(conn, "fills_backfilled") or {}
        status = db.get_setting(conn, "fills_status") or {}
        for market, fetch in (("KR", self._kr), ("US", self._us)):
            days = RECENT_DAYS if done.get(market) else BACKFILL_DAYS
            try:
                rows = []
                for start, end in fills.chunks(today - timedelta(days=days), today):
                    rows += fetch(start, end)
                if market == "KR":
                    # kt00015에 아직 안 잡혔을 수 있는 최근 닷새(주말 낀 결제 전 체결)는 하루치 조회로 채웁니다.
                    for back in range(5):
                        rows += self.kiwoom.kr_day_fills(today - timedelta(days=back))
                merged = self._merge(rows)
                db.save_fills(conn, merged)
                log.info("%s 체결 내역 확인: %d건", "국내" if market == "KR" else "미국", len(merged))
                if not done.get(market):
                    done[market] = True
                    db.set_setting(conn, "fills_backfilled", done)
                status[market] = {"at": now.isoformat(), "ok": True, "count": len(merged)}
            except Exception as e:
                log.warning("%s 체결 내역 가져오기 실패: %s", "국내" if market == "KR" else "미국", e)
                # 화면에서 바로 보이도록 마지막 결과를 남깁니다. 키가 섞이지 않게 오류 문구만 짧게 둡니다.
                status[market] = {"at": now.isoformat(), "ok": False, "error": str(e)[:200]}
        db.set_setting(conn, "fills_status", status)

    def _kr(self, start: str, end: str) -> list:
        return self.kiwoom.kr_fills(start, end)

    def _us(self, start: str, end: str) -> list:
        return self.kiwoom.us_fills(start, end)

    @staticmethod
    def _merge(rows: list) -> list:
        # 같은 날·종목·방향이 kt00015에 있으면 그 묶음만 쓰고, 없을 때만 하루치 조회 값을 씁니다.
        main = fills.group([f for f in rows if f.source != "kt00009"])
        keys = {f.key for f in main}
        return main + [f for f in fills.group([f for f in rows if f.source == "kt00009"]) if f.key not in keys]
