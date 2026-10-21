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

from . import ai, ask, commands, db, telegram
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


def question(update: dict, chat_id: str) -> str | None:
    """명령이 아닌, 내가 보낸 보통 말이면 그 글(AI에게 물어볼 질문)."""
    msg = update.get("message") or {}
    if str((msg.get("chat") or {}).get("id")) != str(chat_id):
        return None
    text = (msg.get("text") or "").strip()
    if not text or text.startswith("/") or commands.parse(text):
        return None
    return text[:500]


class Bot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.http = httpx.Client(timeout=WAIT + 10)
        self.ai_http = httpx.Client(timeout=60)
        self.key, self.model, self.ask = ai.text_asker(cfg)
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
                with psycopg.connect(self.cfg.database_url, autocommit=True, options="-c timezone=Asia/Seoul") as conn:
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
                    reply = "⚠️ 지금은 답하기 어려워요.\n잠시 뒤 다시 보내 주세요."
                if reply:
                    telegram.send(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, reply, self.http)
                elif (q := question(update, self.cfg.telegram_chat_id)) is not None:
                    self._answer(conn, q)

    def _answer(self, conn: psycopg.Connection, q: str) -> None:
        token, chat = self.cfg.telegram_bot_token, self.cfg.telegram_chat_id
        if not self.ask:
            telegram.send(token, chat, "🤖 AI 키가 없어서 대화는 못 해요.\n.env에 GEMINI_API_KEY를 넣으면 질문에 답해 드려요.\n\n명령 목록은 /도움", self.http)
            return
        try:
            # 답을 쓰는 동안 "입력 중…"을 띄워요.
            self.http.post(f"{self.base}/sendChatAction", json={"chat_id": chat, "action": "typing"})
            text = ask.answer(conn, q, lambda system, prompt: self.ask(system, prompt, self.key, self.model, self.ai_http, 1024))
        except Exception as e:
            log.warning("텔레그램 질문 답하기 실패: %s", e)
            text = "⚠️ 지금은 AI가 답하기 어려워요. 잠시 뒤 다시 물어봐 주세요."
        telegram.deliver(token, chat, text, self.http, html=True)
