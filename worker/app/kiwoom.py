"""키움 REST API 조회 전용 클라이언트.

주문 API는 의도적으로 구현하지 않습니다. 조회(잔고)만 호출합니다.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

import httpx

KST_FORMAT = "%Y%m%d%H%M%S"


@dataclass(frozen=True)
class Holding:
    ticker: str
    name: str
    quantity: Decimal
    avg_price: Decimal
    cur_price: Decimal
    eval_amount: Decimal
    pnl: Decimal
    pnl_pct: Decimal


@dataclass(frozen=True)
class Balance:
    holdings: list[Holding]
    total_buy: Decimal
    total_eval: Decimal
    total_pnl: Decimal
    total_pnl_pct: Decimal
    est_deposit: Decimal


def parse_number(raw: str | int | float | None) -> Decimal:
    """'+000000070000', '-00012', '12.34', '' 같은 키움 숫자 문자열을 Decimal로 바꿉니다."""
    text = str(raw if raw is not None else "").strip().replace(",", "")
    if text in ("", "+", "-"):
        return Decimal(0)
    return Decimal(text)


def parse_price(raw: str | None) -> Decimal:
    # 현재가는 등락 부호(+/-)가 붙어 오므로 절댓값을 씁니다.
    return abs(parse_number(raw))


def split_ticker(raw: str) -> str:
    # 잔고의 종목번호는 'A005930'처럼 접두어 1자리 + 코드 6자리입니다.
    raw = raw.strip()
    if len(raw) == 7 and raw[0].isalpha():
        return raw[1:]
    return raw


def parse_balance(body: dict) -> Balance:
    holdings = [
        Holding(
            ticker=split_ticker(row["stk_cd"]),
            name=row["stk_nm"].strip(),
            quantity=parse_number(row["rmnd_qty"]),
            avg_price=parse_price(row["pur_pric"]),
            cur_price=parse_price(row["cur_prc"]),
            eval_amount=parse_number(row.get("evlt_amt")),
            pnl=parse_number(row.get("evltv_prft")),
            pnl_pct=parse_number(row.get("prft_rt")),
        )
        for row in body.get("acnt_evlt_remn_indv_tot", [])
        if parse_number(row.get("rmnd_qty")) > 0
    ]
    return Balance(
        holdings=holdings,
        total_buy=parse_number(body.get("tot_pur_amt")),
        total_eval=parse_number(body.get("tot_evlt_amt")),
        total_pnl=parse_number(body.get("tot_evlt_pl")),
        total_pnl_pct=parse_number(body.get("tot_prft_rt")),
        est_deposit=parse_number(body.get("prsm_dpst_aset_amt")),
    )


@dataclass(frozen=True)
class UsBalance:
    """미국 주식 잔고. 금액은 모두 달러, exch_rate는 원/달러 환율입니다."""
    holdings: list[Holding]
    total_buy: Decimal
    total_eval: Decimal
    total_pnl: Decimal
    total_pnl_pct: Decimal
    exch_rate: Decimal


def parse_us_balance(body: dict) -> UsBalance:
    rows = [
        row for row in body.get("result_list", [])
        if row.get("crnc_code", "USD").strip().upper() == "USD" and parse_number(row.get("poss_qty")) > 0
    ]
    holdings = [
        Holding(
            ticker=row["stk_cd"].strip(),
            name=(row.get("frgn_stk_nm") or row["stk_cd"]).strip(),
            quantity=parse_number(row["poss_qty"]),
            avg_price=parse_price(row.get("frgn_stk_book_uv")),
            cur_price=parse_price(row.get("now_pric")),
            eval_amount=parse_number(row.get("evlt_amt")),
            pnl=parse_number(row.get("pl_amt")),
            pnl_pct=parse_number(row.get("pl_rt")),
        )
        for row in rows
    ]
    rates = [parse_number(row.get("exch_rate")) for row in rows]
    return UsBalance(
        holdings=holdings,
        total_buy=parse_number(body.get("tot_prch_amt")),
        total_eval=parse_number(body.get("tot_evlt_amt")),
        total_pnl=parse_number(body.get("tot_pl_amt")),
        total_pnl_pct=parse_number(body.get("tot_pl_rt")),
        exch_rate=next((r for r in rates if r > 0), Decimal(0)),
    )


@dataclass(frozen=True)
class Cash:
    """계좌의 남은 예수금. 국내는 원, 미국은 달러입니다. 알 수 없는 값은 None."""
    currency: str
    deposit: Decimal
    d2_deposit: Decimal | None
    orderable: Decimal | None


def parse_kr_cash(body: dict) -> Cash:
    # kt00001 예수금상세현황: entr 예수금, d2_entra D+2 추정예수금, ord_alow_amt 주문가능금액
    return Cash(
        currency="KRW",
        deposit=parse_number(body.get("entr")),
        d2_deposit=parse_number(body.get("d2_entra")),
        orderable=parse_number(body.get("ord_alow_amt")),
    )


def _usd_rows(body: dict) -> list[dict]:
    rows = [body]
    for value in body.values():
        if isinstance(value, list):
            rows += [r for r in value if isinstance(r, dict) and str(r.get("crnc_code", "USD")).strip().upper() == "USD"]
    return rows


def _first(rows: list[dict], words: tuple[str, ...]) -> Decimal | None:
    for row in rows:
        for key, value in row.items():
            if any(w in key for w in words) and not isinstance(value, (list, dict)):
                return parse_number(value)
    return None


def parse_us_cash(body: dict) -> Cash:
    """ust21110 해외주식 예수금. 응답 항목 이름이 공개 문서로 확인되지 않아 이름 패턴으로 찾습니다.

    못 찾으면 항목 이름(값 제외)을 담아 오류를 내서, 로그를 보고 고칠 수 있게 합니다.
    """
    rows = _usd_rows(body)
    deposit = _first(rows, ("entr", "dpst", "dps"))
    if deposit is None:
        keys = sorted({k for row in rows for k in row})
        raise ValueError(f"미국 예수금 항목을 찾지 못했습니다. 응답 항목: {', '.join(keys)}")
    return Cash(currency="USD", deposit=deposit, d2_deposit=None, orderable=_first(rows, ("ord_alow", "ord_psbl", "orderable")))


class KiwoomClient:
    def __init__(self, base_url: str, appkey: str, secretkey: str, http: httpx.Client | None = None):
        self._base_url = base_url
        self._appkey = appkey
        self._secretkey = secretkey
        self._http = http or httpx.Client(timeout=10)
        self._token: str | None = None
        self._token_expires: datetime | None = None

    def _access_token(self) -> str:
        # 토큰은 만료 10분 전까지 재사용합니다. 재발급을 반복하면 제한에 걸립니다.
        if self._token and self._token_expires and datetime.now() < self._token_expires - timedelta(minutes=10):
            return self._token
        res = self._http.post(
            f"{self._base_url}/oauth2/token",
            headers={"Content-Type": "application/json;charset=UTF-8"},
            json={"grant_type": "client_credentials", "appkey": self._appkey, "secretkey": self._secretkey},
        )
        res.raise_for_status()
        body = res.json()
        # 키움은 키가 틀려도 200을 돌려주고 본문에 오류 코드만 담습니다.
        if str(body.get("return_code", "0")) != "0" or not body.get("token"):
            raise RuntimeError(f"키움 토큰 발급 실패 ({body.get('return_code')}): {body.get('return_msg')}")
        self._token = body["token"]
        self._token_expires = datetime.strptime(body["expires_dt"], KST_FORMAT)
        return self._token

    def _post(self, path: str, api_id: str, payload: dict) -> dict:
        res = self._http.post(
            f"{self._base_url}{path}",
            headers={
                "Content-Type": "application/json;charset=UTF-8",
                "authorization": f"Bearer {self._access_token()}",
                "api-id": api_id,
            },
            json=payload,
        )
        res.raise_for_status()
        body = res.json()
        if str(body.get("return_code", "0")) != "0":
            raise RuntimeError(f"키움 API 오류 {api_id}: {body.get('return_msg')}")
        return body

    def domestic_balance(self) -> Balance:
        # kt00018 계좌평가잔고내역요청, qry_tp=1 합산
        return parse_balance(self._post("/api/dostk/acnt", "kt00018", {"qry_tp": "1", "dmst_stex_tp": "KRX"}))

    def us_balance(self) -> UsBalance:
        # ust21070 미국주식 원장잔고확인, 빈 값이면 전체 종목
        return parse_us_balance(self._post("/api/us/acnt", "ust21070", {"stex_tp": "", "stk_cd": ""}))

    def kr_cash(self) -> Cash:
        # kt00001 예수금상세현황요청, qry_tp=3 추정조회
        return parse_kr_cash(self._post("/api/dostk/acnt", "kt00001", {"qry_tp": "3"}))

    def kr_minutes(self, ticker: str) -> list:
        # ka10080 주식분봉차트조회요청, 1분봉(수정주가). 최근 것부터 한 번에 약 900개
        from .intraday import parse_kr_minutes
        return parse_kr_minutes(self._post("/api/dostk/chart", "ka10080", {"stk_cd": ticker, "tic_scope": "1", "upd_stkpc_tp": "1"}))

    def value_rank(self, market_code: str) -> list:
        # ka10032 거래대금상위요청. 001 코스피, 101 코스닥, 관리종목 제외, KRX 기준
        from .screener import parse_value_rank
        return parse_value_rank(self._post("/api/dostk/rkinfo", "ka10032", {"mrkt_tp": market_code, "mang_stk_incls": "0", "stex_tp": "1"}))

    def kr_bars(self, ticker: str, base_day: str) -> list:
        # ka10081 일봉(수정주가). 검색기는 고가·거래량·거래대금까지 씁니다.
        from .screener import parse_kr_bars
        return parse_kr_bars(self._post("/api/dostk/chart", "ka10081", {"stk_cd": ticker, "base_dt": base_day, "upd_stkpc_tp": "1"}))

    def kr_daily(self, ticker: str, base_day: str) -> list:
        # ka10081 주식일봉차트조회요청. base_dt부터 과거로, 수정주가(upd_stkpc_tp=1) 기준
        from .prices import parse_kr_daily

        return parse_kr_daily(self._post("/api/dostk/chart", "ka10081", {"stk_cd": ticker, "base_dt": base_day, "upd_stkpc_tp": "1"}))

    def kr_quote(self, ticker: str):
        # ka10001 주식기본정보요청. 관심종목 현재가
        from .watch import parse_kr_quote
        return parse_kr_quote(ticker, self._post("/api/dostk/stkinfo", "ka10001", {"stk_cd": ticker}))

    def kr_sector(self, ticker: str) -> str:
        # ka10100 종목정보 조회. 업종명(upName)
        from .watch import parse_kr_sector
        return parse_kr_sector(self._post("/api/dostk/stkinfo", "ka10100", {"stk_cd": ticker}))

    def us_cash(self) -> Cash:
        # ust21110 해외주식 예수금 조회
        return parse_us_cash(self._post("/api/us/acnt", "ust21110", {}))
