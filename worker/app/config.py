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
    dart_api_key: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    finnhub_api_key: str = ""
    sec_contact_email: str = ""
    anthropic_api_key: str = ""
    ai_model: str = ""

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
        dart_api_key=os.environ.get("DART_API_KEY", ""),
        naver_client_id=os.environ.get("NAVER_CLIENT_ID", ""),
        naver_client_secret=os.environ.get("NAVER_CLIENT_SECRET", ""),
        finnhub_api_key=os.environ.get("FINNHUB_API_KEY", ""),
        sec_contact_email=os.environ.get("SEC_CONTACT_EMAIL", ""),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        ai_model=os.environ.get("AI_MODEL", ""),
    )
