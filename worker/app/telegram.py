import html as htmllib
import logging
import re

import httpx

log = logging.getLogger("worker")
_shared = httpx.Client(timeout=10)


def send(bot_token: str, chat_id: str, text: str, http: httpx.Client | None = None, html: bool = False) -> None:
    client = http or _shared
    body = {"chat_id": chat_id, "text": text}
    if html:
        body["parse_mode"] = "HTML"  # 굵게(<b>)·고정폭 표(<pre>)를 써요
    res = client.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json=body)
    res.raise_for_status()


def deliver(bot_token: str, chat_id: str, text: str, http: httpx.Client | None = None, html: bool = False) -> bool:
    """보냈으면(또는 보냈을 가능성이 크면) True. 실패해도 예외를 던지지 않아 다음 알림은 계속 갑니다.

    요청은 갔는데 답만 늦은 경우(ReadTimeout)는 텔레그램이 이미 받았을 수 있어, 다시 보내면 두 번 가므로 보낸 것으로 칩니다."""
    try:
        if html:
            send(bot_token, chat_id, text, http, html=True)
        else:
            send(bot_token, chat_id, text, http)
        return True
    except httpx.ReadTimeout:
        log.warning("텔레그램 응답이 늦어 보낸 것으로 칩니다")
        return True
    except httpx.HTTPStatusError as e:
        # 꾸밈(HTML)이 텔레그램에서 거절되면 꾸밈을 빼고 한 번 더 보내요.
        if html and e.response.status_code == 400:
            log.warning("텔레그램이 꾸민 글을 거절해 꾸밈 없이 다시 보냅니다")
            return deliver(bot_token, chat_id, plain(text), http)
        log.exception("텔레그램 보내기 실패, 다음에 다시 보냅니다")
        return False
    except Exception:
        log.exception("텔레그램 보내기 실패, 다음에 다시 보냅니다")
        return False


def plain(text: str) -> str:
    """HTML 꾸밈을 빼고 글만 남겨요."""
    return htmllib.unescape(re.sub(r"</?(b|i|pre|code|blockquote)>", "", text))
