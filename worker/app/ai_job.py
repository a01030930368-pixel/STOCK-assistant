"""AI 한마디 일정. 각 시장 장 마감 30분 뒤 보유 종목마다 하루 한 번 씁니다. 한 번도 쓴 적 없는 종목은 바로 씁니다."""
import logging
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import ai, db
from .config import Config
from .market import is_holiday

log = logging.getLogger("worker")

AFTER = {"KR": (ZoneInfo("Asia/Seoul"), time(16, 0)), "US": (ZoneInfo("America/New_York"), time(16, 30))}


def target_day(market: str, now: datetime):
    """그날 장이 끝난 뒤라면 그 날짜를, 아니면 None을 돌려줍니다."""
    tz, after = AFTER[market]
    local = now.astimezone(tz)
    if local.weekday() >= 5 or is_holiday(market, local.date()) or local.time() < after:
        return None
    return local.date()


class AiJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.cfg = cfg
        self.http = http
        # 무료인 Gemini 키를 먼저 씁니다.
        if cfg.gemini_api_key:
            self.key, self.model, self.ask = cfg.gemini_api_key, cfg.ai_model or ai.DEFAULT_GEMINI_MODEL, ai.ask_gemini
        else:
            self.key, self.model, self.ask = cfg.anthropic_api_key, cfg.ai_model or ai.DEFAULT_MODEL, ai.ask

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        if not self.key:
            return
        now = now or datetime.now(timezone.utc)
        done = db.ai_comment_days(conn)
        for ticker, name, market in db.held_stocks(conn):
            day = target_day(market, now)
            last = done.get(ticker)
            if last is None:
                day = day or now.astimezone(AFTER[market][0]).date()
            elif day is None or last >= day:
                continue
            try:
                c = self.ask(ai.build_prompt(db.ai_context(conn, ticker, name, market)), self.key, self.model, self.http)
                db.save_ai_comment(conn, ticker, day, c.tone, c.body, self.model)
            except Exception as e:
                log.warning("%s AI 한마디 실패: %s", name, e)
