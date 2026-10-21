"""저녁 일정 알림과 아침 브리핑을 하루 한 번씩만 보냅니다. 보낸 기록은 DB에 남겨 워커를 다시 켜도 두 번 가지 않습니다."""
import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import ai, books, briefing, db, prices, telegram, terms
from .config import Config

log = logging.getLogger("worker")
US_NEWS_HOURS = 18  # 아침 8시 기준 전날 오후 2시 이후 뉴스 = 미국 장 전후


class BriefingJob:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.cfg = cfg
        self.http = http
        self.key, self.model, self.ask = ai.text_asker(cfg)
        # 아침 브리핑은 그날 한 번만 만들고, 못 보낸 조각부터 10분 뒤에 다시 보내요(매분 다시 만들지 않게).
        self._morning_parts: tuple[object, list[str], int, object] | None = None
        self._morning_retry: datetime | None = None

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        # 주간 성적표에서 지난주와 비교하려고 텔레그램이 없어도 날마다 내 돈 전체를 적어 둡니다.
        db.record_assets(conn, now.astimezone(briefing.KST).date())
        if not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id):
            return
        # 하나가 실패해도 나머지 알림은 그대로 보냅니다.
        for step in (self._evening, self._earnings_eve, self._reviews, self._weekly, self._morning):
            try:
                step(conn, now)
            except Exception:
                log.exception("%s 알림 실패", step.__name__)

    def _send(self, text: str) -> bool:
        return telegram.deliver(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, text, self.http)

    def _evening(self, conn: psycopg.Connection, now: datetime) -> None:
        day = briefing.evening_due(now)
        if day is None:
            return
        key = f"evening:{day.isoformat()}"
        if db.notice_sent(conn, key):
            return
        text = briefing.evening_message(day, [briefing.Item(*r) for r in db.events_on(conn, day)])
        if text:
            if not self._send(text):
                return
            log.info("내일 일정 알림을 보냈습니다")
        db.mark_notice(conn, key)

    def _earnings_eve(self, conn: psycopg.Connection, now: datetime) -> None:
        day = briefing.evening_due(now)
        if day is None:
            return
        for ticker, eve in db.earnings_eve(conn, day):
            key = f"earnings:{ticker}:{day.isoformat()}"
            if db.notice_sent(conn, key):
                continue
            if not self._send(briefing.earnings_eve_message(day, briefing.EarningsEve(*eve))):
                continue
            log.info("%s 실적 전날 알림을 보냈습니다", ticker)
            db.mark_notice(conn, key)

    def _reviews(self, conn: psycopg.Connection, now: datetime) -> None:
        # 지난 일주일 안에 전량 매도했고 아직 사후강평이 없는 권을, 판 다음 날 저녁 8시부터 한 번씩 알려 줍니다.
        day = briefing.evening_due(now)
        if day is None:
            return
        today = day - timedelta(days=1)
        trades, held, reviewed = db.review_inputs(conn)
        for book in books.closed_books(trades, held):
            # 매도만 있는 권(키움 기록보다 먼저 산 주식)과 '일지 안 씀'으로 넘긴 권은 일기장에 안 보이므로 알리지 않아요.
            if not book.bought or book.skipped or not (today - timedelta(days=7) <= book.end < today) or book.key in reviewed:
                continue
            key = f"review:{book.key}"
            if db.notice_sent(conn, key):
                continue
            if not self._send(briefing.review_message(book)):
                continue
            log.info("%s 사후강평 알림을 보냈습니다", book.name)
            db.mark_notice(conn, key)

    def _weekly(self, conn: psycopg.Connection, now: datetime) -> None:
        start = briefing.weekly_due(now)
        if start is None:
            return
        key = f"weekly:{start.isoformat()}"
        if db.notice_sent(conn, key):
            return
        end = start + timedelta(days=6)
        total, last_total, moves, events = db.weekly_inputs(conn, start, end)
        trades, held, reviewed = db.review_inputs(conn)
        closed_all, sold = books.replay(trades, held)
        week = [t for t in trades if start <= t.day <= end]
        realized: dict[str, float] = {}
        for s in sold:
            if start <= s.day <= end and s.pnl is not None:
                realized[s.market] = realized.get(s.market, 0.0) + s.pnl
        closed = [(b.name, b.return_pct) for b in closed_all if start <= b.end <= end]
        unreviewed = sum(1 for b in closed_all if b.bought and not b.skipped and b.key not in reviewed and b.end > end - timedelta(days=30))
        if not self._send(briefing.weekly_message(briefing.Week(
                start, total, last_total, moves, sum(t.side == "buy" for t in week), sum(t.side == "sell" for t in week),
                realized, closed, unreviewed, events))):
            return
        log.info("주간 성적표를 보냈습니다")
        db.mark_notice(conn, key)

    def _morning(self, conn: psycopg.Connection, now: datetime) -> None:
        day = briefing.morning_due(now)
        if day is None:
            return
        key = f"morning:{day.isoformat()}"
        if db.notice_sent(conn, key):
            return
        if self._morning_retry and now < self._morning_retry:
            return
        if not self._morning_parts or self._morning_parts[0] != day:
            holdings = [briefing.Holding(*r) for r in db.briefing_holdings(conn)]
            items = [briefing.Item(*r) for r in db.events_on(conn, day)]
            indexes = self._indexes()
            us = self._us(conn, now, indexes)
            fx, fx_prev = self._fx(conn, indexes) if us else (None, None)
            # 오늘의 용어는 못 만들어도 브리핑은 그대로 보내요.
            try:
                term_at = terms.next_index(conn, db.get_setting)
                term = terms.message(conn, term_at)
            except Exception as e:
                log.warning("오늘의 용어 만들기 실패: %s", e)
                term_at, term = None, None
            text = briefing.morning_message(day, indexes, holdings, items, us, fx, fx_prev, term)
            self._morning_parts = (day, telegram.split(text), 0, term_at)
        _, parts, sent, term_at = self._morning_parts
        while sent < len(parts):
            if not telegram.deliver(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, parts[sent], self.http, html=True):
                self._morning_parts = (day, parts, sent, term_at)
                self._morning_retry = now + timedelta(minutes=10)
                return
            sent += 1
        self._morning_parts, self._morning_retry = None, None
        log.info("아침 브리핑을 보냈습니다 (메시지 %d개)", len(parts))
        db.mark_notice(conn, key)
        if term_at is not None:
            db.set_setting(conn, "terms_next", term_at + 1)

    def _fx(self, conn: psycopg.Connection, indexes: list[briefing.Quote]) -> tuple[float | None, float | None]:
        # 원/달러 지금 값과 전날 값. 야후가 막히면 키움 잔고의 환율(전날 값은 모름)로 대신해요.
        for q in indexes:
            if q.name == "원/달러" and q.last:
                return q.last, q.last / (1 + q.change_pct / 100) if q.change_pct is not None else None
        return db.us_exchange_rate(conn), None

    def _us(self, conn: psycopg.Connection, now: datetime, indexes: list[briefing.Quote]) -> list[briefing.UsStock]:
        """미국 보유 종목마다 밤사이 종가 두 개(야후), 밤사이 뉴스, AI 한마디. 종가를 못 받은 종목은 빼요."""
        since = now - timedelta(hours=US_NEWS_HOURS)
        stocks, news = [], {}
        for ticker, name, qty, avg, cur in db.briefing_us(conn):
            try:
                bars = prices.yahoo_daily(ticker, self.http, span="5d")
            except Exception as e:
                log.warning("%s 밤사이 종가 가져오기 실패: %s", ticker, e)
                continue
            if not bars:
                continue
            last, prev = float(bars[-1].close), float(bars[-2].close) if len(bars) > 1 else None
            news[ticker] = db.news_since(conn, ticker, since)
            stocks.append(briefing.UsStock(ticker, name, qty, last, prev, avg, news[ticker][0] if news[ticker] else None))
        if stocks and self.ask:
            try:
                lines = briefing.parse_us_ai(
                    self.ask(briefing.US_AI_SYSTEM, briefing.us_ai_prompt(stocks, indexes, news), self.key, self.model, self.http, 800),
                    [s.ticker for s in stocks])
                stocks = [replace(s, ai=lines.get(s.ticker)) for s in stocks]
            except Exception as e:
                log.warning("아침 브리핑 AI 한마디 실패, 빼고 보냅니다: %s", e)
        return stocks

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
