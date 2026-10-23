import pytest

from app import ai


@pytest.fixture(autouse=True)
def _no_busy_wait(monkeypatch):
    # 붐빔(503) 다시 묻기 전 쉬는 시간은 테스트에선 건너뛰어요.
    monkeypatch.setattr(ai, "BUSY_WAIT", 0)
