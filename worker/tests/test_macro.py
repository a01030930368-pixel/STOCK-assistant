from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.macro import fetch_ecos, fetch_fred, yoy


def ecos(rows):
    return {"StatisticSearch": {"list_total_count": len(rows), "row": rows}}


def row(time, value):
    return {"STAT_CODE": "x", "TIME": time, "DATA_VALUE": value}


def test_yoy_uses_same_month_last_year():
    rows = [row("202509", "100.00"), row("202608", "102.00"), row("202609", "102.50")]
    result = yoy(rows)
    assert result.value == Decimal("2.50")
    assert result.as_of == "202609"


def test_yoy_none_without_last_year():
    assert yoy([row("202609", "102.5")]) is None


def test_fetch_ecos_reads_latest_values():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "/722Y001/" in path:
            return httpx.Response(200, json=ecos([row("202609", "2.50"), row("202608", "2.75")]))
        if "/731Y001/" in path:
            return httpx.Response(200, json=ecos([row("20261016", "1380.5"), row("20261017", "1375.2")]))
        if "/901Y009/" in path:
            return httpx.Response(200, json=ecos([row("202509", "100"), row("202609", "102")]))
        raise AssertionError(path)

    got = {i.code: i for i in fetch_ecos("KEY", date(2026, 10, 19), httpx.Client(transport=httpx.MockTransport(handler)))}
    assert got["kr_base_rate"].value == Decimal("2.50") and got["kr_base_rate"].as_of == "202609"
    assert got["usdkrw"].value == Decimal("1375.2")
    assert got["kr_cpi_yoy"].value == Decimal("2.00")


def test_fetch_ecos_reports_api_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키가 유효하지 않습니다."}})

    with pytest.raises(RuntimeError, match="인증키가 유효하지 않습니다"):
        fetch_ecos("BAD", date(2026, 10, 19), httpx.Client(transport=httpx.MockTransport(handler)))


def test_fetch_fred_skips_missing_values():
    def handler(request: httpx.Request) -> httpx.Response:
        series = request.url.params["series_id"]
        if series == "DFEDTARU":
            return httpx.Response(200, json={"observations": [{"date": "2026-10-18", "value": "."}, {"date": "2026-10-17", "value": "4.25"}]})
        assert request.url.params["units"] == "pc1"
        return httpx.Response(200, json={"observations": [{"date": "2026-09-01", "value": "2.9312"}]})

    got = {i.code: i for i in fetch_fred("KEY", httpx.Client(transport=httpx.MockTransport(handler)))}
    assert got["us_base_rate"].value == Decimal("4.25") and got["us_base_rate"].as_of == "2026-10-17"
    assert got["us_cpi_yoy"].value == Decimal("2.93")
