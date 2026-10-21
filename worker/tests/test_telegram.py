import httpx

from app import telegram


def test_deliver_reports_failure_without_raising():
    def fail(request):
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(fail))
    assert telegram.deliver("t", "c", "hi", client) is False


def test_deliver_counts_late_answer_as_sent():
    def slow(request):
        raise httpx.ReadTimeout("late", request=request)

    client = httpx.Client(transport=httpx.MockTransport(slow))
    assert telegram.deliver("t", "c", "hi", client) is True


def test_split_keeps_paragraphs_under_limit():
    text = "\n\n".join(f"문단{i} " + "가" * 50 for i in range(10))
    parts = telegram.split(text, limit=130)
    assert all(len(p) <= 130 for p in parts)
    assert "\n\n".join(parts) == text
    assert telegram.split("짧아요") == ["짧아요"]


def test_split_cuts_a_single_huge_line():
    parts = telegram.split("x" * 250, limit=100)
    assert [len(p) for p in parts] == [100, 100, 50]
