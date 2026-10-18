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
