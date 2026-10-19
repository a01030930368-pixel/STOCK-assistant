"""미국 뉴스 제목을 한국어로 옮깁니다. 키 없이 쓰는 구글 번역 주소라 막히면 영어 제목을 그대로 둡니다."""
import re

import httpx

GOOGLE = "https://translate.googleapis.com/translate_a/single"
HANGUL = re.compile(r"[가-힣]")


def needs_translation(text: str) -> bool:
    return bool(text.strip()) and not HANGUL.search(text)


def to_korean(text: str, http: httpx.Client) -> str:
    res = http.get(GOOGLE, params={"client": "gtx", "sl": "auto", "tl": "ko", "dt": "t", "q": text})
    res.raise_for_status()
    # 응답은 [[["번역", "원문", ...], ...], ...] 모양이고, 문장마다 조각이 나뉘어 옵니다.
    out = "".join(part[0] for part in res.json()[0] if part and part[0]).strip()
    if not out:
        raise ValueError("번역 결과가 비어 있습니다.")
    return out
