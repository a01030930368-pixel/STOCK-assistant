import logging

import httpx

log = logging.getLogger("worker")
_shared = httpx.Client(timeout=10)


def send(bot_token: str, chat_id: str, text: str, http: httpx.Client | None = None) -> None:
    client = http or _shared
    res = client.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={"chat_id": chat_id, "text": text})
    res.raise_for_status()


def deliver(bot_token: str, chat_id: str, text: str, http: httpx.Client | None = None) -> bool:
    """보냈으면(또는 보냈을 가능성이 크면) True. 실패해도 예외를 던지지 않아 다음 알림은 계속 갑니다.

    요청은 갔는데 답만 늦은 경우(ReadTimeout)는 텔레그램이 이미 받았을 수 있어, 다시 보내면 두 번 가므로 보낸 것으로 칩니다."""
    try:
        send(bot_token, chat_id, text, http)
        return True
    except httpx.ReadTimeout:
        log.warning("텔레그램 응답이 늦어 보낸 것으로 칩니다")
        return True
    except Exception:
        log.exception("텔레그램 보내기 실패, 다음에 다시 보냅니다")
        return False
