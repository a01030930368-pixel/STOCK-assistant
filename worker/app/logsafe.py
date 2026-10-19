"""로그에 API 키가 찍히지 않도록 가립니다."""
import logging


class RedactingFormatter(logging.Formatter):
    def __init__(self, fmt: str, secrets: list[str]):
        super().__init__(fmt)
        # 짧은 값은 평범한 단어까지 가릴 수 있어 제외합니다.
        self.secrets = sorted({s for s in secrets if len(s) >= 8}, key=len, reverse=True)

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        for s in self.secrets:
            text = text.replace(s, "***")
        return text


def setup(secrets: list[str]) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(RedactingFormatter("%(asctime)s %(levelname)s %(message)s", secrets))
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    # httpx는 요청마다 키가 담긴 주소를 남겨서, 실패만 보이게 줄입니다.
    logging.getLogger("httpx").setLevel(logging.WARNING)
