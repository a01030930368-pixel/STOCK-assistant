"""실적 발표 한눈에.

국내: 공시 알림(DisclosureJob)이 잠정실적 공시를 찾으면 kr()로 본문 표를 읽어 정리하고, 그 글을 알림으로 보내요.
미국: 30분마다 실적 발표 일정 앞뒤인 종목만 Finnhub에서 실제·예상 값을 받아 정리하고 알려요.
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import ai, db, earnings, research, telegram
from .config import Config
from .disclosures import Disclosure

log = logging.getLogger("worker")

EVERY = timedelta(minutes=30)
FRESH_DAYS = 2  # 발표일이 이틀 안인 것만 알려요. 처음 켰을 때 지난 실적이 쏟아지지 않게요.
RETRY = timedelta(hours=12)  # 일정이 없는 종목도 12시간에 한 번은 지난 실적을 채워 봐요(종목 페이지용).


class EarningsJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.cfg = cfg
        self.http = http
        self.last: datetime | None = None
        self.tried: dict[str, datetime] = {}
        self.backfilled: set[str] = set()  # 한 번 읽어 본 옛 잠정실적(표를 못 읽어도 다시 받지 않아요)
        self.key, self.model, self.ask = ai.text_asker(cfg)
        self.explained: set = set()

    # ------------------------------------------------------------ 국내(공시 알림에서 불러요)

    def kr(self, conn: psycopg.Connection, d: Disclosure, held: bool = True) -> str | None:
        """잠정실적 공시면 정리해서 저장하고 알림 글을 돌려줘요. 다른 공시이거나 표를 못 읽으면 None(보통 공시 알림으로)."""
        if not earnings.PRELIMINARY.search(d.title):
            return None
        rid = f"KR:{d.rcept_no}"
        if saved := db.earnings_report(conn, rid):
            return earnings.message(saved[0], saved[1], held)
        try:
            parsed = earnings.parse_preliminary(research.dart_document_text(d.rcept_no, self.cfg.dart_api_key, self.http), d.day)
        except Exception as e:
            log.warning("%s 잠정실적 읽기 실패: %s", d.name, e)
            return None
        if not parsed:
            log.warning("%s 잠정실적 표를 찾지 못했어요", d.name)
            return None
        period, lines = parsed
        cur = {k: lines[k]["cur"] for k in ("revenue", "operating_income") if k in lines}
        r = earnings.Report(
            id=rid, ticker=d.ticker, name=d.name, market="KR", period=period, reported_on=d.day, url=d.url, lines=lines,
            history=earnings.kr_history(period, cur, db.statement_quarters(conn, d.ticker)),
        )
        text = self._explain(conn, r)
        db.save_earnings_report(conn, r, text)
        return earnings.message(r, text, held)

    # ------------------------------------------------------------ 미국

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if self.last and now - self.last < EVERY:
            return
        self.last = now
        if self.cfg.dart_api_key:
            self._backfill_kr(conn)
        if self.cfg.finnhub_api_key:
            self._us(conn, now)

    def _backfill_kr(self, conn: psycopg.Connection) -> None:
        """업데이트 전에 이미 지나간 잠정실적도 종목 페이지에 보이도록 정리만 해 둬요(알림 없음)."""
        for row in db.unreported_preliminary(conn):
            if row[0] in self.backfilled:
                continue
            self.backfilled.add(row[0])
            self.kr(conn, Disclosure(*row))

    def _us(self, conn: psycopg.Connection, now: datetime) -> None:
        today = now.date()
        for ticker, name, held in db.us_stocks(conn):
            soon = db.earnings_soon(conn, ticker, today - timedelta(days=FRESH_DAYS + 1), today + timedelta(days=1))
            tried = self.tried.get(ticker)
            if not soon and tried and now - tried < RETRY:
                continue
            self.tried[ticker] = now
            try:
                entries = earnings.finnhub_entries(ticker, self.cfg.finnhub_api_key, today, self.http)
            except Exception as e:
                log.warning("%s 실적 확인 실패: %s", ticker, e)
                continue
            r = earnings.us_report(ticker, name, entries)
            if not r:
                continue
            saved = db.earnings_report(conn, r.id)
            text = saved[1] if saved and saved[1] else None
            fresh = (today - r.reported_on).days <= FRESH_DAYS
            # 해설은 보고서마다 한 번만 시도해요. 비어 돌아와도 30분마다 다시 부르면 무료 AI 한도만 써요.
            if text is None and fresh and r.id not in self.explained:
                self.explained.add(r.id)
                text = self._explain(conn, r)
            db.save_earnings_report(conn, r, text)
            if fresh:
                self._send(conn, f"earnings:{r.id}", earnings.message(r, text or "", held))

    # ------------------------------------------------------------ 공통

    def _explain(self, conn: psycopg.Connection, r: earnings.Report) -> str:
        """숫자와 최근 뉴스로 AI가 2~3문장 해설. 키가 없거나 실패하면 빈 글."""
        if not self.ask:
            return ""
        try:
            prompt = earnings.ai_prompt(r, db.recent_news(conn, r.ticker))
            return earnings.clean(self.ask(earnings.AI_SYSTEM, prompt, self.key, self.model, self.http, 600))
        except Exception as e:
            log.warning("%s 실적 해설 실패: %s", r.name, e)
            return ""

    def _send(self, conn: psycopg.Connection, key: str, text: str) -> None:
        if not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id) or db.notice_sent(conn, key):
            return
        if telegram.deliver(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, text, self.http):
            db.mark_notice(conn, key)
