"""보유 국내 종목(ISA 포함)과 국내 관심종목의 새 공시를 10분마다 확인하고, 중요한 것만 텔레그램으로 바로 보냅니다."""
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import ai, db, disclosures, research, telegram
from .config import Config
from .market import KST

log = logging.getLogger("worker")

EVERY = timedelta(minutes=10)
FIRST_DAYS = 30  # 처음 보는 종목은 한 달 치를 채워요(알림은 안 보내요)
RECENT_DAYS = 3  # 그 뒤로는 최근 3일만 다시 봐요(정정 공시, 늦게 올라온 공시)
FRESH_DAYS = 1  # 접수일이 어제·오늘인 공시만 알려요. 워커를 오래 껐다 켜도 옛 공시가 쏟아지지 않게요.


class DisclosureJob:
    def __init__(self, cfg: Config, http: httpx.Client, codes):
        self.cfg = cfg
        self.http = http
        self.codes = codes  # 종목코드 -> DART 고유번호를 돌려주는 함수(종목 정보 수집이 하루 한 번 받아 둠)
        self.last: datetime | None = None
        self.key, self.model, self.ask = ai.text_asker(cfg)

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if not self.cfg.dart_api_key or (self.last and now - self.last < EVERY):
            return
        codes = self.codes()
        if not codes:
            return
        self.last = now
        today = now.astimezone(KST).date()
        # 한 번이라도 채운 종목. 공시가 하나도 없던 종목도 넣어야 다음 공시를 알릴 수 있어요.
        seeded = set(db.get_setting(conn, "disclosure_seeded") or [])
        before = set(seeded)
        for ticker, name, held in db.disclosure_stocks(conn):
            corp = codes.get(ticker)
            if not corp:  # ETF·ETN은 DART 회사가 아니라 공시가 없어요
                continue
            first = ticker not in seeded
            since = today - timedelta(days=FIRST_DAYS if first else RECENT_DAYS)
            try:
                found = disclosures.fetch(ticker, name, corp, self.cfg.dart_api_key, since, today, self.http)
            except Exception as e:
                log.warning("%s 공시 확인 실패: %s", name, e)
                continue
            db.save_disclosures(conn, found)
            for d in found:
                if first:
                    # 처음 채운 공시는 이미 지난 거라 알리지 않고, 보낸 것으로 적어 둬요.
                    db.mark_notice(conn, f"disclosure:{d.rcept_no}")
                elif d.kind.important and (today - d.day).days <= FRESH_DAYS:
                    self._alert(conn, d, held)
            seeded.add(ticker)
        if seeded != before:
            db.set_setting(conn, "disclosure_seeded", sorted(seeded))

    def _alert(self, conn: psycopg.Connection, d: disclosures.Disclosure, held: bool) -> None:
        if not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id):
            return
        key = f"disclosure:{d.rcept_no}"
        if db.notice_sent(conn, key):
            return
        summary = self._summary(conn, d)
        if telegram.deliver(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, disclosures.message(d, held, summary), self.http):
            db.mark_notice(conn, key)

    def _summary(self, conn: psycopg.Connection, d: disclosures.Disclosure) -> str:
        """AI가 본문을 읽고 숫자를 넣어 한 줄로 정리해요. 키가 없거나 실패하면 빈 글(종류 풀이로 대신)."""
        if not self.ask:
            return ""
        if saved := db.disclosure_summary(conn, d.rcept_no):
            return saved
        try:
            text = disclosures.plain_text(research.dart_document_text(d.rcept_no, self.cfg.dart_api_key, self.http))
            line = disclosures.clean_summary(self.ask(disclosures.SUMMARY_SYSTEM, disclosures.summary_prompt(d, text), self.key, self.model, self.http, 400))
        except Exception as e:
            log.warning("%s 공시 요약 실패: %s", d.name, e)
            return ""
        if line:
            db.save_disclosure_summary(conn, d.rcept_no, line)
        return line
