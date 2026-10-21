"""키움 REST API 조회 전용 클라이언트.

주문 API는 의도적으로 구현하지 않습니다. 조회(잔고)만 호출합니다.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
import threading
import time
from zoneinfo import ZoneInfo

import httpx

KST_FORMAT = "%Y%m%d%H%M%S"
KST = ZoneInfo("Asia/Seoul")
# 키움은 초당 요청 수를 제한합니다. 요청 사이에 이만큼 쉬고, 초과 오류면 잠깐 쉬었다 한 번 더 보냅니다.
MIN_GAP = 0.25
TOO_MANY = ("요청개수", "(429)")
# 토큰이 만료되었거나 무효라는 응답이면 새로 받아 한 번 더 보냅니다.
BAD_TOKEN = ("토큰", "token", "8005:")
# 띄어쓰기 없이 비교합니다. 예: '[2000](501724:관련자료가없습니다)'
NO_DATA = ("자료가없", "내역이없", "데이터가없", "조회건수가없")


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
        self._lock = threading.Lock()
        self._last_call = 0.0

    def _wait_turn(self) -> None:
        # 여러 작업이 동시에 불러도 키움 요청은 MIN_GAP 간격으로 하나씩 나갑니다.
        with self._lock:
            gap = MIN_GAP - (time.monotonic() - self._last_call)
            if gap > 0:
                time.sleep(gap)
            self._last_call = time.monotonic()

    def _access_token(self) -> str:
        # 토큰은 만료 10분 전까지 재사용합니다. 재발급을 반복하면 제한에 걸립니다.
        # expires_dt는 한국 시간이므로 지금 시각도 한국 시간으로 비교합니다(컨테이너는 UTC).
        now = datetime.now(KST).replace(tzinfo=None)
        if self._token and self._token_expires and now < self._token_expires - timedelta(minutes=10):
            return self._token
        self._wait_turn()
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

    def _request(self, path: str, api_id: str, payload: dict, next_key: str | None = None) -> httpx.Response:
        for attempt in range(3):
            try:
                return self._send(path, api_id, payload, next_key)
            except RuntimeError as e:
                text = str(e).replace(" ", "")
                if attempt < 2 and any(word in text for word in TOO_MANY):
                    time.sleep(1 + attempt)
                    continue
                if attempt == 0 and any(word in text.lower() for word in BAD_TOKEN):
                    self._token = None
                    continue
                raise
        raise AssertionError("unreachable")

    def _send(self, path: str, api_id: str, payload: dict, next_key: str | None) -> httpx.Response:
        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "authorization": f"Bearer {self._access_token()}",
            "api-id": api_id,
        }
        if next_key:
            headers["cont-yn"] = "Y"
            headers["next-key"] = next_key
        self._wait_turn()
        res = self._http.post(f"{self._base_url}{path}", headers=headers, json=payload)
        if res.status_code == 429:
            raise RuntimeError(f"키움 API 오류 {api_id}: 요청 개수 초과(429)")
        if res.status_code == 401:
            raise RuntimeError(f"키움 API 오류 {api_id}: token 401")
        res.raise_for_status()
        body = res.json()
        if str(body.get("return_code", "0")) != "0":
            raise RuntimeError(f"키움 API 오류 {api_id}: {body.get('return_msg')}")
        return res

    def _post(self, path: str, api_id: str, payload: dict) -> dict:
        return self._request(path, api_id, payload).json()

    def _post_pages(self, path: str, api_id: str, payload: dict, list_key: str, max_pages: int = 30) -> list[dict]:
        # 응답 헤더 cont-yn=Y이면 next-key를 붙여 같은 요청을 다시 보내 다음 쪽을 받습니다.
        rows: list[dict] = []
        next_key = None
        for _ in range(max_pages):
            try:
                res = self._request(path, api_id, payload, next_key)
            except RuntimeError as e:
                # 내역이 없으면 오류 코드로 '조회할 자료가 없습니다' 같은 문구를 돌려줍니다. 빈 목록으로 봅니다.
                if any(word in str(e).replace(" ", "") for word in NO_DATA):
                    break
                raise
            rows.extend(res.json().get(list_key) or [])
            next_key = res.headers.get("next-key", "").strip()
            if res.headers.get("cont-yn", "N").upper() != "Y" or not next_key:
                break
        return rows

    def _post_all(self, path: str, api_id: str, payload: dict, list_key: str, max_pages: int = 10) -> dict:
        # 첫 쪽 본문(합계 포함)에 다음 쪽들의 목록을 이어 붙입니다. 보유 종목이 많아도 빠지지 않게요.
        res = self._request(path, api_id, payload)
        body = res.json()
        rows = list(body.get(list_key) or [])
        for _ in range(max_pages - 1):
            next_key = res.headers.get("next-key", "").strip()
            if res.headers.get("cont-yn", "N").upper() != "Y" or not next_key:
                break
            res = self._request(path, api_id, payload, next_key)
            rows.extend(res.json().get(list_key) or [])
        body[list_key] = rows
        return body

    def domestic_balance(self) -> Balance:
        # kt00018 계좌평가잔고내역요청, qry_tp=1 합산
        return parse_balance(self._post_all("/api/dostk/acnt", "kt00018", {"qry_tp": "1", "dmst_stex_tp": "KRX"}, "acnt_evlt_remn_indv_tot"))

    def us_balance(self) -> UsBalance:
        # ust21070 미국주식 원장잔고확인, 빈 값이면 전체 종목
        return parse_us_balance(self._post_all("/api/us/acnt", "ust21070", {"stex_tp": "", "stk_cd": ""}, "result_list"))

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

    def all_sectors(self) -> list:
        # ka20003 전업종지수요청. 001 코스피 업종 전체
        from .sectors import parse_all_sectors
        return parse_all_sectors(self._post("/api/dostk/sect", "ka20003", {"inds_cd": "001"}))

    def sector_daily(self, code: str, base_day: str, price=None) -> list:
        # ka20006 업종일봉조회요청. base_dt부터 과거로
        from .sectors import parse_sector_daily
        return parse_sector_daily(self._post("/api/dostk/chart", "ka20006", {"inds_cd": code, "base_dt": base_day}), price)

    def sector_leaders(self, code: str) -> list:
        # ka20002 업종별주가요청. 0 코스피, 1 KRX
        from .sectors import parse_leaders
        return parse_leaders(self._post("/api/dostk/sect", "ka20002", {"mrkt_tp": "0", "inds_cd": code, "stex_tp": "1"}))

    def investor_flows(self, ticker: str, day: str) -> list:
        # ka10059 종목별투자자기관별요청. 금액(1)·순매수(0)·단주(1), day부터 과거로
        from .flows import parse_flows
        payload = {"dt": day, "stk_cd": ticker, "amt_qty_tp": "1", "trde_tp": "0", "unit_tp": "1"}
        return parse_flows(self._post_pages("/api/dostk/stkinfo", "ka10059", payload, "stk_invsr_orgn", max_pages=2))

    def themes(self, ticker: str = "") -> list:
        # ka90001 테마그룹별요청. 종목코드가 있으면 그 종목이 든 테마만(qry_tp 2). 기간수익률은 5일, 등락률 상위순
        from .flows import parse_themes
        payload = {"qry_tp": "2" if ticker else "0", "stk_cd": ticker, "date_tp": "5", "thema_nm": "", "flu_pl_amt_tp": "3", "stex_tp": "1"}
        return parse_themes(self._post_pages("/api/dostk/thme", "ka90001", payload, "thema_grp", max_pages=1 if ticker else 10))

    def us_cash(self) -> Cash:
        # ust21110 해외주식 예수금 조회
        return parse_us_cash(self._post("/api/us/acnt", "ust21110", {}))

    def kr_fills(self, start: str, end: str) -> list:
        # kt00015 위탁종합거래내역요청. tp=3 매매, gds_tp=1 국내주식, 거래소 전체(KRX+NXT)
        from .fills import parse_kr_fills
        payload = {"strt_dt": start, "end_dt": end, "tp": "3", "stk_cd": "", "crnc_cd": "", "gds_tp": "1",
                   "frgn_stex_code": "", "dmst_stex_tp": "%"}
        return parse_kr_fills(self._post_pages("/api/dostk/acnt", "kt00015", payload, "trst_ovrl_trde_prps_array"))

    def us_fills(self, start: str, end: str, ticker: str | None = None) -> list:
        # ust21180 미국주식 기간별 주문내역. 체결 수량이 있는 줄만 씁니다.
        # 거래소구분(stex_tp)을 넣으면 종목코드도 요구하므로, 전체 조회에서는 둘 다 보내지 않습니다.
        from .fills import parse_us_fills
        payload = {"strt_dt": start, "end_dt": end, "slby_tp": "0"}
        if ticker:
            payload["stk_cd"] = ticker
        return parse_us_fills(self._post_pages("/api/us/acnt", "ust21180", payload, "result_list"))

    def kr_day_fills(self, day) -> list:
        # kt00009 계좌별주문체결현황요청. 하루치 체결만(qry_tp=1), 주식, 거래소 전체
        from .fills import parse_kr_day_fills
        payload = {"ord_dt": day.strftime("%Y%m%d"), "stk_bond_tp": "1", "mrkt_tp": "0", "sell_tp": "0", "qry_tp": "1",
                   "stk_cd": "", "fr_ord_no": "", "dmst_stex_tp": "%"}
        return parse_kr_day_fills(day, self._post_pages("/api/dostk/acnt", "kt00009", payload, "acnt_ord_cntr_prst_array"))
