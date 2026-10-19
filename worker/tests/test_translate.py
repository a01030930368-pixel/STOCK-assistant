import httpx
import pytest

from app.translate import needs_translation, to_korean


def test_needs_translation_skips_korean():
    assert needs_translation("Why IREN stocks crashed")
    assert not needs_translation("삼성전자 3분기 실적")
    assert not needs_translation("  ")


def test_to_korean_joins_sentence_parts():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["tl"] == "ko"
        return httpx.Response(200, json=[[["첫 문장. ", "First. ", None], ["둘째 문장", "Second", None]], None, "en"])

    http = httpx.Client(transport=httpx.MockTransport(handler))
    assert to_korean("First. Second", http) == "첫 문장. 둘째 문장"


def test_to_korean_raises_on_block():
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429)))
    with pytest.raises(httpx.HTTPStatusError):
        to_korean("Hello", http)
