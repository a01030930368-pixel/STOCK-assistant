import logging

from app.logsafe import RedactingFormatter


def test_hides_keys_in_message_and_traceback():
    fmt = RedactingFormatter("%(message)s", ["abcd1234efgh", "", "short"])
    try:
        raise ValueError("GET https://x/?token=abcd1234efgh failed")
    except ValueError:
        import sys
        record = logging.LogRecord("t", logging.ERROR, "", 0, "url %s", ("token=abcd1234efgh",), sys.exc_info())
    out = fmt.format(record)
    assert "abcd1234efgh" not in out
    assert "token=***" in out
    assert "short" not in fmt.secrets
