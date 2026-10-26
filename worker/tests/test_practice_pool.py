from datetime import datetime, timedelta, timezone
from unittest import mock

from app import practice_pool

NOW = datetime(2026, 10, 22, 3, tzinfo=timezone.utc)


def test_pool_has_both_markets_without_duplicates():
    rows = practice_pool.pool()
    tickers = [r[0] for r in rows]
    assert len(tickers) == len(set(tickers))
    assert ("005930", "삼성전자", "KR") in rows and ("035900", "JYP Ent.", "KR") in rows
    assert ("AAPL", "Apple", "US") in rows
    assert all(r[2] == "KR" for r in rows if r[0].isdigit()) and all(r[2] == "US" for r in rows if not r[0].isdigit())
    assert sum(r[2] == "KR" for r in rows) >= 250 and sum(r[2] == "US" for r in rows) >= 250
    assert all(len(r[0]) == 6 for r in rows if r[2] == "KR")


def test_job_fetches_due_tickers_and_records_errors():
    kiwoom = mock.Mock()
    kiwoom.kr_daily.return_value = ["bar"]
    job = practice_pool.PoolJob(mock.Mock(), kiwoom)
    with mock.patch.object(practice_pool, "db") as db, mock.patch.object(practice_pool.prices, "us_daily", side_effect=RuntimeError("404")):
        db.practice_due.return_value = [("005930", "KR"), ("ZZZZ", "US")]
        job.run(mock.Mock(), NOW)
        job.run(mock.Mock(), NOW)
    assert db.seed_practice_pool.call_count == 1
    kiwoom.kr_daily.assert_called_with("005930", "20261022")
    db.save_prices.assert_called_with(mock.ANY, "005930", ["bar"])
    assert db.practice_fetched.call_args_list[0].args[1:] == ("005930", NOW, None, None, 3)
    # 오류는 6시간 뒤 다시 받아 봐요(30일 쉬지 않게).
    assert db.practice_fetched.call_args_list[1].args[1:] == ("ZZZZ", NOW, "404", NOW + timedelta(hours=6), 3)
    assert db.practice_due.call_args.kwargs["now"] == NOW
    db.set_setting.assert_called_once_with(mock.ANY, "practice_kr_off", False)


def test_empty_result_is_not_retried_soon():
    kiwoom = mock.Mock()
    kiwoom.kr_daily.return_value = []
    job = practice_pool.PoolJob(mock.Mock(), kiwoom)
    with mock.patch.object(practice_pool, "db") as db:
        db.practice_due.return_value = [("005930", "KR")]
        job.run(mock.Mock(), NOW)
    assert db.practice_fetched.call_args.args[1:] == ("005930", NOW, "일봉이 비어 있어요", None, 3)
