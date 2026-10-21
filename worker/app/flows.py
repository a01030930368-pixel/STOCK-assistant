"""투자자별 수급(국내)과 테마 동향(국내).

수급: 키움 ka10059(종목별투자자기관별) 순매수 금액. 금액 단위는 백만원이라 그대로 두고 화면에서 억으로 바꿔요.
테마: 키움 ka90001(테마그룹별) 전체 테마의 오늘 등락·5일 수익률·오른 종목 수·주요 종목,
      그리고 내 종목이 들어 있는 테마(같은 ka90001을 종목코드로 물어요).
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .kiwoom import parse_number, parse_price

KEEP_DAYS = 120


@dataclass
class Flow:
    day: date
    close: Decimal
    foreign: Decimal  # 백만원, + 순매수 / − 순매도
    institution: Decimal
    individual: Decimal


def parse_flows(rows: list[dict]) -> list[Flow]:
    """ka10059 stk_invsr_orgn: dt, cur_prc, frgnr_invsr 외국인, orgn 기관계, ind_invsr 개인."""
    out = {}
    for r in rows:
        day = str(r.get("dt", "")).strip()
        if len(day) != 8:
            continue
        if "frgnr_invsr" not in r or "orgn" not in r:
            raise ValueError(f"키움 수급 항목 이름이 달라요: {', '.join(sorted(r))}")
        d = date(int(day[:4]), int(day[4:6]), int(day[6:]))
        out[d] = Flow(d, parse_price(r.get("cur_prc")), parse_number(r.get("frgnr_invsr")), parse_number(r.get("orgn")), parse_number(r.get("ind_invsr")))
    return [out[d] for d in sorted(out)][-KEEP_DAYS:]


@dataclass
class Theme:
    code: str
    name: str
    stocks: int
    change_pct: Decimal
    week_pct: Decimal | None
    rising: int
    falling: int
    leader: str


def parse_themes(rows: list[dict]) -> list[Theme]:
    """ka90001 thema_grp: thema_grp_cd, thema_nm, stk_num, flu_rt, rising_stk_num, fall_stk_num, dt_prft_rt(기간수익률), main_stk."""
    out = {}
    for r in rows:
        code, name = str(r.get("thema_grp_cd", "")).strip(), str(r.get("thema_nm", "")).strip()
        if not code or not name:
            continue
        week = str(r.get("dt_prft_rt", "")).strip()
        out[code] = Theme(code, name, int(parse_number(r.get("stk_num"))), parse_number(r.get("flu_rt")),
                          parse_number(week) if week else None, int(parse_number(r.get("rising_stk_num"))),
                          int(parse_number(r.get("fall_stk_num"))), str(r.get("main_stk", "")).strip())
    if rows and not out:
        raise ValueError(f"키움 테마 항목 이름이 달라요: {', '.join(sorted(rows[0]))}")
    return list(out.values())
