"""종목 검색기 데이터 갱신. 장중에는 30분마다, 장 마감 뒤 한 번 더 국내 거래대금 상위 종목 지표를 다시 계산합니다."""
import logging
import time
from datetime import datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from . import db, screener
from .market import is_holiday, kr_market_open

log = logging.getLogger("worker")

KST = ZoneInfo("Asia/Seoul")
EVERY = timedelta(minutes=30)
AFTER_CLOSE = dtime(15, 40)
MARKETS = {"001": "코스피", "101": "코스닥"}
PER_MARKET = 100
PAUSE = 0.25  # 키움 조회 한도를 넘지 않도록 일봉 요청 사이에 쉽니다.


def due(now: datetime, last: datetime | None) -> bool:
    if last is None:
        return True
    if kr_market_open(now):
        return now - last >= EVERY
    # 장이 끝난 뒤 아직 마감 값으로 계산하지 않았으면 한 번 더 돕니다.
    local = now.astimezone(KST)
    close = datetime.combine(local.date(), AFTER_CLOSE, KST)
    return local.weekday() < 5 and not is_holiday("KR", local.date()) and local >= close and last < close


class ScreenerJob:
    def __init__(self, kiwoom):
        self.kiwoom = kiwoom
        self.last: datetime | None = None
        # 종목별 일봉은 하루에 한 번만 받고, 장중에는 순위 응답의 현재가로 오늘 봉만 바꿉니다.
        self.bars: dict[str, tuple[object, list[screener.Bar]]] = {}

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if not self.kiwoom or not due(now, self.last):
            return
        self.last = now
        today = now.astimezone(KST).date()
        rank: dict[str, screener.RankRow] = {}
        for code, label in MARKETS.items():
            try:
                rows = self.kiwoom.value_rank(code)
                if not rows:
                    log.warning("검색기 %s 거래대금 순위(ka10032) 응답에 종목이 없습니다", label)
                for row in rows[:PER_MARKET]:
                    rank.setdefault(row.ticker, row)
            except Exception as e:
                log.warning("검색기 %s 거래대금 순위 실패: %s", label, e)
        if not rank:
            return
        out = []
        for ticker, row in rank.items():
            cached = self.bars.get(ticker)
            if not cached or cached[0] != today:
                try:
                    self.bars[ticker] = (today, self.kiwoom.kr_bars(ticker, today.strftime("%Y%m%d")))
                except Exception as e:
                    log.warning("검색기 %s 일봉 실패: %s", row.name, e)
                    continue
                time.sleep(PAUSE)
            m = screener.metrics(ticker, row.name, screener.with_today(self.bars[ticker][1], today, row))
            if m:
                out.append(m)
        # 순위에서 빠진 종목의 일봉은 메모리에서 지웁니다.
        self.bars = {t: v for t, v in self.bars.items() if t in rank}
        if out:
            db.save_screener(conn, "KR", out)
        log.info("검색기 갱신: 순위 %d종목 중 %d종목 계산 (screener)", len(rank), len(out))
