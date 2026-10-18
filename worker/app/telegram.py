import httpx


def send(bot_token: str, chat_id: str, text: str, http: httpx.Client | None = None) -> None:
    client = http or httpx.Client(timeout=10)
    res = client.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={"chat_id": chat_id, "text": text})
    res.raise_for_status()
