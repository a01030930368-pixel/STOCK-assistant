"""종목 검색기용 지표 계산. 국내 거래대금 상위 종목의 일봉으로 RSI·이동평균·거래량 배수 등을 구합니다.

조건 비교는 웹에서 합니다. 워커는 종목마다 지표만 계산해 screener_stocks에 넣습니다.
"""
import math
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Bar:
    day: date
    close: float
    high: float
    volume: float
    value: float  # 거래대금(원)


@dataclass(frozen=True)
class Metrics:
    ticker: str
    name: str
    day: date
    price: float
    change_pct: float | None
    trade_value: float
    volume_ratio: float | None
    rsi14: float | None
    ma5: float | None
    ma20: float | None
    ma20_gap_pct: float | None
    golden_cross: bool
    high_52w: float
    near_high_pct: float
    spark: list[float] = field(default_factory=list)


def _num(raw) -> float:
    from .kiwoom import parse_number

    return float(abs(parse_number(raw)))


def _ticker(raw: str) -> str:
    # 순위 응답은 'A005930', '005930_AL'처럼 올 수 있어 6자리 코드만 남깁니다.
    code = str(raw).strip().split("_")[0]
    return code[1:] if len(code) == 7 and code[0].isalpha() else code


def to_won(close: float, volume: float, raw_value: float) -> float:
    """거래대금 단위(원·천원·백만원)가 TR마다 달라, 가격×거래량과 비교해 원으로 맞춥니다."""
    if raw_value <= 0:
        return close * volume
    if close <= 0 or volume <= 0:
        return raw_value
    unit = 10 ** round(math.log10(close * volume / raw_value))
    return raw_value * unit


@dataclass(frozen=True)
class RankRow:
    ticker: str
    name: str
    price: float
    volume: float
    value: float


def parse_value_rank(body: dict) -> list[RankRow]:
    # ka10032 거래대금상위. 목록 키 이름이 바뀌어도 되도록 stk_cd가 든 첫 목록을 씁니다.
    rows = next((v for v in body.values() if isinstance(v, list) and v and isinstance(v[0], dict) and "stk_cd" in v[0]), [])
    out = []
    for r in rows:
        ticker = _ticker(r.get("stk_cd", ""))
        if len(ticker) != 6 or not ticker.isdigit():
            continue  # ETN 등 숫자 6자리가 아닌 종목은 건너뜁니다.
        price, volume = _num(r.get("cur_prc")), _num(r.get("now_trde_qty"))
        out.append(RankRow(ticker, str(r.get("stk_nm", "")).strip(), price, volume, to_won(price, volume, _num(r.get("trde_prica")))))
    return out


def parse_kr_bars(body: dict) -> list[Bar]:
    out = []
    for r in body.get("stk_dt_pole_chart_qry") or []:
        day = str(r.get("dt", "")).strip()
        close = _num(r.get("cur_prc"))
        if len(day) != 8 or close <= 0:
            continue
        volume = _num(r.get("trde_qty"))
        out.append(Bar(date(int(day[:4]), int(day[4:6]), int(day[6:])), close, _num(r.get("high_pric")) or close,
                       volume, to_won(close, volume, _num(r.get("trde_prica")))))
    return sorted(out, key=lambda b: b.day)


def with_today(bars: list[Bar], today: date, row: RankRow) -> list[Bar]:
    """장중에는 순위 응답의 현재가·거래량으로 오늘 봉을 덮어써서 일봉을 다시 받지 않아도 되게 합니다."""
    if row.price <= 0:
        return bars
    past = [b for b in bars if b.day < today]
    old = next((b for b in bars if b.day == today), None)
    high = max(row.price, old.high if old else row.price)
    return past + [Bar(today, row.price, high, row.volume or (old.volume if old else 0), row.value or (old.value if old else 0))]


def rsi(closes: list[float], period: int = 14) -> float | None:
    # 와일더(Wilder) 방식. 증권사 HTS의 RSI와 같은 계산입니다.
    if len(closes) <= period:
        return None
    gains = [max(b - a, 0) for a, b in zip(closes, closes[1:])]
    losses = [max(a - b, 0) for a, b in zip(closes, closes[1:])]
    g, l = sum(gains[:period]) / period, sum(losses[:period]) / period
    for gi, li in zip(gains[period:], losses[period:]):
        g, l = (g * (period - 1) + gi) / period, (l * (period - 1) + li) / period
    if l == 0:
        return 100.0
    return 100 - 100 / (1 + g / l)


def _ma(closes: list[float], n: int, end: int | None = None) -> float | None:
    end = len(closes) if end is None else end
    if end < n:
        return None
    return sum(closes[end - n:end]) / n


def metrics(ticker: str, name: str, bars: list[Bar]) -> Metrics | None:
    if len(bars) < 2:
        return None
    closes = [b.close for b in bars]
    last, prev = bars[-1], bars[-2]
    ma5, ma20 = _ma(closes, 5), _ma(closes, 20)
    # 최근 3거래일 안에 5일선이 20일선을 아래에서 위로 뚫었으면 골든크로스로 봅니다.
    cross = False
    for k in range(1, 4):
        a5, a20 = _ma(closes, 5, len(closes) - k), _ma(closes, 20, len(closes) - k)
        b5, b20 = _ma(closes, 5, len(closes) - k + 1), _ma(closes, 20, len(closes) - k + 1)
        if None not in (a5, a20, b5, b20) and a5 <= a20 and b5 > b20:
            cross = True
    prior = [b.volume for b in bars[-21:-1] if b.volume > 0]
    high = max(b.high for b in bars[-250:])
    return Metrics(
        ticker=ticker, name=name, day=last.day, price=last.close,
        change_pct=(last.close / prev.close - 1) * 100 if prev.close else None,
        trade_value=last.value,
        volume_ratio=last.volume / (sum(prior) / len(prior)) if len(prior) >= 5 else None,
        rsi14=rsi(closes),
        ma5=ma5, ma20=ma20,
        ma20_gap_pct=(last.close / ma20 - 1) * 100 if ma20 else None,
        golden_cross=cross,
        high_52w=high,
        near_high_pct=(last.close / high - 1) * 100,
        spark=closes[-20:],
    )


def dec(v: float | None, places: int = 2) -> Decimal | None:
    return None if v is None else round(Decimal(str(v)), places)
