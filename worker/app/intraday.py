"""분봉. 국내는 키움 ka10080(주식분봉차트) 1분봉, 미국은 키 없이 쓰는 야후 파이낸스 차트(비공식) 1분봉을 받습니다.

3·5·15·30·60분봉은 웹에서 1분봉을 묶어 만듭니다. 최근 며칠치만 보관합니다.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx

KST = ZoneInfo("Asia/Seoul")
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/"
KEEP_DAYS = 8
UA = "Mozilla/5.0 (LODESTAR personal dashboard)"


@dataclass(frozen=True)
class MinuteBar:
    ts: datetime  # 그 1분이 시작한 시각
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


def parse_kr_minutes(body: dict) -> list[MinuteBar]:
    from .kiwoom import parse_number, parse_price

    out = []
    for row in body.get("stk_min_pole_chart_qry") or []:
        tm, close = str(row.get("cntr_tm", "")).strip(), parse_price(row.get("cur_prc"))
        if len(tm) < 12 or close <= 0:
            continue
        ts = datetime(int(tm[:4]), int(tm[4:6]), int(tm[6:8]), int(tm[8:10]), int(tm[10:12]), tzinfo=KST)
        o, h, l = (parse_price(row.get(k)) or close for k in ("open_pric", "high_pric", "low_pric"))
        out.append(MinuteBar(ts, o, max(h, close), min(l, close), close, abs(parse_number(row.get("trde_qty")))))
    return sorted(out, key=lambda b: b.ts)


def parse_yahoo(body: dict) -> list[MinuteBar]:
    result = ((body.get("chart") or {}).get("result") or [None])[0]
    if not result:
        err = (body.get("chart") or {}).get("error") or {}
        raise ValueError(f"야후 차트 응답이 비어 있습니다: {err.get('description', '')[:60]}")
    q = (result.get("indicators", {}).get("quote") or [{}])[0]
    out = []
    for i, t in enumerate(result.get("timestamp") or []):
        vals = [q.get(k, [None])[i] if i < len(q.get(k, [])) else None for k in ("open", "high", "low", "close", "volume")]
        if any(v is None for v in vals[:4]):
            continue  # 거래가 없던 1분은 비어 옵니다.
        o, h, l, c = (round(Decimal(str(v)), 4) for v in vals[:4])
        out.append(MinuteBar(datetime.fromtimestamp(t, timezone.utc), o, max(h, c), min(l, c), c, Decimal(int(vals[4] or 0))))
    return out


def yahoo_minutes(ticker: str, http: httpx.Client) -> list[MinuteBar]:
    res = http.get(f"{YAHOO}{ticker.upper()}", params={"interval": "1m", "range": "5d"},
                   headers={"User-Agent": UA})
    res.raise_for_status()
    return parse_yahoo(res.json())
