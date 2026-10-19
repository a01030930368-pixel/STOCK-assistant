import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    database_url: str
    kiwoom_appkey: str
    kiwoom_secretkey: str
    kiwoom_mock: bool
    telegram_bot_token: str
    telegram_chat_id: str
    poll_seconds: int
    ecos_api_key: str = ""
    fred_api_key: str = ""

    @property
    def kiwoom_base_url(self) -> str:
        return "https://mockapi.kiwoom.com" if self.kiwoom_mock else "https://api.kiwoom.com"


def load() -> Config:
    return Config(
        database_url=os.environ["DATABASE_URL"],
        kiwoom_appkey=os.environ.get("KIWOOM_APPKEY", ""),
        kiwoom_secretkey=os.environ.get("KIWOOM_SECRETKEY", ""),
        kiwoom_mock=os.environ.get("KIWOOM_MOCK", "true").lower() == "true",
        telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=os.environ.get("TELEGRAM_CHAT_ID", ""),
        poll_seconds=int(os.environ.get("POLL_SECONDS", "60")),
        ecos_api_key=os.environ.get("ECOS_API_KEY", ""),
        fred_api_key=os.environ.get("FRED_API_KEY", ""),
    )
