"""텔레그램 명령 받기. 본 작업 루프와 따로 도는 스레드에서 메시지를 기다렸다가 바로 답합니다.

설정한 TELEGRAM_CHAT_ID에서 온 메시지에만 답하고, 다른 사람이 봇에 말을 걸면 무시합니다.
"""
import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import commands, db, telegram
from .config import Config

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")
WAIT = 25  # 텔레그램 쪽에서 새 메시지를 기다려 주는 초


def answer(conn: psycopg.Connection, command: str, today) -> str:
    if command == "balance":
        rows, rate = db.command_accounts(conn)
        return commands.balance_text([commands.Account(*r) for r in rows], rate)
    if command == "holdings":
        return commands.holdings_text(db.command_holdings(conn))
    if command == "alerts":
        return commands.alerts_text(db.command_alerts(conn))
    if command == "calendar":
        return commands.calendar_text(db.command_calendar(conn, today))
    if command == "watch":
        return commands.watch_text(db.command_watch(conn))
    return commands.help_text()


def handle(conn: psycopg.Connection, update: dict, chat_id: str, today) -> str | None:
    """답할 글. 남이 보낸 메시지나 명령이 아닌 말이면 None."""
    msg = update.get("message") or {}
    if str((msg.get("chat") or {}).get("id")) != str(chat_id):
        return None
    text = msg.get("text") or ""
    command = commands.parse(text)
    if command is None:
        return commands.help_text() if text.startswith("/") else None
    return answer(conn, command, today)


class Bot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.http = httpx.Client(timeout=WAIT + 10)
        self.base = f"https://api.telegram.org/bot{cfg.telegram_bot_token}"

    def start(self) -> None:
        if not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id):
            return
        threading.Thread(target=self._loop, name="telegram-bot", daemon=True).start()

    def _menu(self) -> None:
        # 입력창의 "/" 메뉴에 명령 목록이 뜨게 합니다.
        try:
            self.http.post(f"{self.base}/setMyCommands", json={
                "commands": [{"command": c, "description": d} for c, d in commands.MENU],
            }).raise_for_status()
        except Exception as e:
            log.warning("텔레그램 명령 메뉴 등록 실패: %s", e)

    def _loop(self) -> None:
        self._menu()
        while True:
            try:
                with psycopg.connect(self.cfg.database_url, autocommit=True) as conn:
                    self._poll(conn)
            except Exception as e:
                log.warning("텔레그램 명령 받기 실패, 30초 뒤 다시 시도: %s", e)
                time.sleep(30)

    def _poll(self, conn: psycopg.Connection) -> None:
        # 마지막으로 읽은 번호를 DB에 남겨, 워커를 다시 켜도 지난 명령에 또 답하지 않습니다.
        offset = db.get_setting(conn, "telegram_offset")
        while True:
            res = self.http.get(f"{self.base}/getUpdates", params={
                "timeout": WAIT, "allowed_updates": '["message"]', **({"offset": offset} if offset else {}),
            })
            res.raise_for_status()
            for update in res.json().get("result", []):
                offset = update["update_id"] + 1
                db.set_setting(conn, "telegram_offset", offset)
                today = datetime.now(KST).date()
                try:
                    reply = handle(conn, update, self.cfg.telegram_chat_id, today)
                except Exception as e:
                    log.warning("텔레그램 명령 처리 실패: %s", e)
                    reply = "지금은 답하기 어려워요. 잠시 뒤 다시 보내 주세요."
                if reply:
                    telegram.send(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, reply, self.http)
