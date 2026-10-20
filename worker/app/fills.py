"""키움 체결 내역을 읽어 '하루·종목·매수/매도' 한 묶음으로 합칩니다. 조회만 하고 주문은 하지 않습니다.

- 국내 kt00015 위탁종합거래내역: 기간 조회, 수수료·세금 포함. 체결일(cntr_dt)로 묶습니다.
- 국내 kt00009 계좌별주문체결현황: 하루씩 조회. 아직 kt00015에 안 잡힌 최근 체결을 채웁니다.
- 미국 ust21180 기간별 주문내역: 체결 수량이 있는 주문만 씁니다.
"""
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import Decimal

from .kiwoom import parse_number, parse_price, split_ticker


@dataclass(frozen=True)
class Fill:
    market: str
    day: date
    ticker: str
    name: str
    side: str  # 'buy' | 'sell'
    quantity: Decimal
    price: Decimal
    fee: Decimal | None
    time: str | None
    source: str
    count: int = 1

    @property
    def key(self) -> str:
        return f"{self.market}:{self.day.isoformat()}:{self.ticker}:{self.side}"


def _day(raw: str | None) -> date | None:
    text = (raw or "").strip().replace("-", "")
    if len(text) != 8 or not text.isdigit():
        return None
    return datetime.strptime(text, "%Y%m%d").date()


def _side(*labels: str | None) -> str | None:
    # 앞 항목을 먼저 봅니다. io_tp_nm '매수'가 rmrk_nm '장내매도'보다 우선입니다.
    for text in labels:
        if "매도" in (text or ""):
            return "sell"
        if "매수" in (text or ""):
            return "buy"
    return None


def _time(raw: str | None) -> str | None:
    text = (raw or "").strip().replace(":", "")
    if len(text) < 4 or not text[:4].isdigit():
        return None
    return f"{text[:2]}:{text[2:4]}"


def parse_kr_fills(rows: list[dict]) -> list[Fill]:
    out = []
    for r in rows:
        # 매매가 아닌 줄(입출금 등)은 종목코드가 없거나 매수·매도 글자가 없어서 걸러집니다.
        # 거래종류 이름(trde_kind_nm)은 '매매', '장내매매'처럼 달라질 수 있어 거르는 데 쓰지 않습니다.
        side = _side(r.get("io_tp_nm"), r.get("rmrk_nm"))
        day = _day(r.get("cntr_dt")) or _day(r.get("trde_dt"))
        qty = parse_number(r.get("trde_qty_jwa_cnt"))
        if not (r.get("stk_cd") or "").strip() or not side or not day or qty <= 0:
            continue
        price = parse_price(r.get("trde_unit"))
        if price <= 0:
            price = parse_number(r.get("trde_amt")) / qty
        fee = parse_number(r.get("tax_sum_cmsn"))
        if fee == 0:
            fee = parse_number(r.get("cmsn")) + parse_number(r.get("trde_agri_tax")) + parse_number(r.get("incm_resi_tax"))
        out.append(Fill("KR", day, split_ticker(r.get("stk_cd") or ""), (r.get("stk_nm") or "").strip(), side,
                        qty, price, fee, None, "kt00015"))
    return out


def parse_kr_day_fills(day: date, rows: list[dict]) -> list[Fill]:
    out = []
    for r in rows:
        side = _side(r.get("io_tp_nm"))
        qty = parse_number(r.get("cntr_qty"))
        price = parse_price(r.get("cntr_uv"))
        if not side or qty <= 0 or price <= 0:
            continue
        out.append(Fill("KR", day, split_ticker(r.get("stk_cd") or ""), (r.get("stk_nm") or "").strip(), side,
                        qty, price, None, _time(r.get("cntr_tm")), "kt00009"))
    return out


def parse_us_fills(rows: list[dict]) -> list[Fill]:
    out = []
    for r in rows:
        side = _side(r.get("slby_tp_nm"))
        day = _day(r.get("ord_dt"))
        qty = parse_number(r.get("cntr_qty"))
        price = parse_price(r.get("cntr_uv"))
        if not side or not day or qty <= 0 or price <= 0:
            continue
        name = (r.get("stk_nm") or r.get("frgn_stk_nm") or "").strip()
        out.append(Fill("US", day, (r.get("stk_cd") or "").strip().upper(), name, side,
                        qty, price, None, _time(r.get("ord_time")), "ust21180"))
    return out


def group(fills: list[Fill]) -> list[Fill]:
    """같은 날 같은 종목을 나눠 사고판 것은 한 묶음으로 합치고 가격은 수량 가중 평균으로 둡니다."""
    groups: dict[str, Fill] = {}
    for f in fills:
        g = groups.get(f.key)
        if g is None:
            groups[f.key] = f
            continue
        qty = g.quantity + f.quantity
        fee = None if g.fee is None and f.fee is None else (g.fee or 0) + (f.fee or 0)
        times = [t for t in (g.time, f.time) if t]
        groups[f.key] = replace(
            g, quantity=qty, price=(g.price * g.quantity + f.price * f.quantity) / qty, fee=fee,
            time=min(times) if times else None, count=g.count + f.count, name=g.name or f.name,
        )
    return sorted(groups.values(), key=lambda f: (f.day, f.time or "", f.ticker))


def chunks(start: date, end: date, days: int = 31) -> list[tuple[str, str]]:
    """긴 기간을 한 달 남짓씩 잘라 YYYYMMDD 쌍으로 돌려줍니다."""
    out = []
    cur = start
    while cur <= end:
        stop = min(cur + timedelta(days=days - 1), end)
        out.append((cur.strftime("%Y%m%d"), stop.strftime("%Y%m%d")))
        cur = stop + timedelta(days=1)
    return out
