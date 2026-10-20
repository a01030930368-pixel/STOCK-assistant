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
