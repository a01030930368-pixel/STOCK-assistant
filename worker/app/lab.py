"""연습하기 › 실험실: 내가 만든 매매 규칙을 연습용 큰 종목(practice_pool) 일봉에 돌려 봐요.

규칙 하나 = 살 때 조건(모두 맞아야) + 팔 때 조건(먼저 오는 것) + 종목(국내/미국/둘 다) + 기간(1·3·5년).
- 살 때 조건이 그날 종가로 다 맞으면 다음 날 시가에 사요(시가가 없으면 그날 종가).
- 팔 때: 손절·익절은 장중 저가·고가로 먼저 봐요(같은 날 둘 다 닿으면 손절로 쳐요, 갭이면 시가에).
  N일 뒤·20일선 이탈은 그날 종가에 팔아요. 기간이 끝날 때까지 안 팔렸으면 마지막 종가로 정리해요.
- 한 종목에 한 번에 하나만 들고, 판 다음 날부터 다시 살 수 있어요.
- 매매 한 번마다 수수료·세금 0.3%를 빼요.
- 비교용 "그냥 들고 있었다면": 같은 날 같은 값에 사서 20거래일 들고 있었을 때.

웹이 lab_rules에 status='queued'로 넣으면 워커가 돌리고 result에 적어요.
"한 줄로" 쓴 규칙은 app_settings 'lab_parse'로 받아 AI가 칸으로 바꿔요(고를 수 있는 칸만, 나머지는 "아직 못 해요").
"""
import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import httpx
import psycopg

from . import ai, db
from .config import Config

log = logging.getLogger("worker")

POLL_SECONDS = 3
COST = 0.3  # %, 사고팔 때 한 번
HOLD_DAYS = 20  # 비교용 보유 기간(거래일)
MAX_TRADES = 3000  # 결과에 남기는 거래 수
BINS = [-20 + 2.5 * i for i in range(17)]  # 히스토그램 경계 -20 ~ +20, 양 끝은 '그 밖'
WARMUP = 260  # 52주 신고가·20일선을 보려고 기간 앞에 더 읽는 봉
BUY_KEYS = ("ma20", "rsi30", "high52", "vol2", "support")
BUY_LABEL = {"ma20": "20일선 위", "rsi30": "RSI 30 아래", "high52": "52주 신고가", "vol2": "거래량 2배", "support": "지지선 터치"}
SUPPORT_DAYS = 60  # 지지선 = 지난 60거래일 최저가
SUPPORT_BAND = 0.02  # 저가가 그 최저가 위 2% 안까지 내려왔다가 최저가 위에서 마감
MAX_HOLD = 250  # 팔 조건이 안 와도 이만큼 들고 있으면 정리


@dataclass
class Bar:
    day: date
    open: float | None
    high: float | None
    low: float | None
    close: float
    volume: float | None


# ---------------------------------------------------------------- 규칙
def clean_rule(raw) -> dict:
    """웹·AI가 준 규칙을 정해진 칸만 남겨 정리해요. 살 때·팔 때 조건이 하나도 없으면 ValueError."""
    raw = raw if isinstance(raw, dict) else {}
    buy_in = raw.get("buy") if isinstance(raw.get("buy"), dict) else {}
    sell_in = raw.get("sell") if isinstance(raw.get("sell"), dict) else {}
    buy = {k: bool(buy_in.get(k)) for k in BUY_KEYS}

    def pos(v, lo, hi):
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return round(min(max(x, lo), hi), 2) if x > 0 else None

    days = pos(sell_in.get("days"), 1, MAX_HOLD)
    sell = {"stop": pos(sell_in.get("stop"), 0.5, 90), "target": pos(sell_in.get("target"), 0.5, 500),
            "days": int(days) if days else None, "ma20break": bool(sell_in.get("ma20break"))}
    market = raw.get("market") if raw.get("market") in ("KR", "US", "ALL") else "ALL"
    try:
        years = int(raw.get("years") or 5)
    except (TypeError, ValueError):
        years = 5
    years = years if years in (1, 3, 5) else 5
    if not any(buy.values()):
        raise ValueError("살 때 조건을 하나 이상 골라 주세요")
    if not (sell["stop"] or sell["target"] or sell["days"] or sell["ma20break"]):
        raise ValueError("팔 때 조건을 하나 이상 골라 주세요")
    return {"buy": buy, "sell": sell, "market": market, "years": years}


# ---------------------------------------------------------------- 지표
def sma(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    s = 0.0
    for i, v in enumerate(values):
        s += v
        if i >= n:
            s -= values[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def rsi(closes: list[float], n: int = 14) -> list[float | None]:
    """와일더 RSI."""
    out: list[float | None] = [None] * len(closes)
    if len(closes) <= n:
        return out
    gain = loss = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        gain += max(d, 0)
        loss += max(-d, 0)
    gain /= n
    loss /= n
    out[n] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        gain = (gain * (n - 1) + max(d, 0)) / n
        loss = (loss * (n - 1) + max(-d, 0)) / n
        out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def signals(bars: list[Bar], buy: dict) -> list[bool]:
    """그날 종가 기준으로 고른 살 때 조건이 모두 맞는 날."""
    closes = [b.close for b in bars]
    n = len(bars)
    ma20 = sma(closes, 20) if buy.get("ma20") else None
    r = rsi(closes) if buy.get("rsi30") else None
    vols = [b.volume or 0.0 for b in bars]
    vavg = sma(vols, 20) if buy.get("vol2") else None
    out = [False] * n
    for i in range(n):
        ok = True
        c = closes[i]
        if ok and ma20 is not None:
            ok = ma20[i] is not None and c > ma20[i]
        if ok and r is not None:
            ok = r[i] is not None and r[i] < 30
        if ok and buy.get("high52"):
            ok = i >= 251 and c > max(closes[i - 251:i])
        if ok and vavg is not None:
            ok = i >= 20 and bool(bars[i].volume) and vavg[i - 1] is not None and vavg[i - 1] > 0 and bars[i].volume >= 2 * vavg[i - 1]
        if ok and buy.get("support"):
            if i < SUPPORT_DAYS:
                ok = False
            else:
                floor = min((b.low if b.low is not None else b.close) for b in bars[i - SUPPORT_DAYS:i])
                low = bars[i].low if bars[i].low is not None else c
                ok = floor > 0 and low <= floor * (1 + SUPPORT_BAND) and c >= floor
        out[i] = ok
    return out


# ---------------------------------------------------------------- 돌리기
def run_ticker(bars: list[Bar], rule: dict, since: date) -> list[dict]:
    """한 종목의 거래 목록. 각 거래 {b, s, bp, sp, r, d, why, hold}."""
    if len(bars) < 30:
        return []
    sig = signals(bars, rule["buy"])
    sell = rule["sell"]
    closes = [b.close for b in bars]
    ma20 = sma(closes, 20) if sell.get("ma20break") else None
    stop = sell.get("stop")
    target = sell.get("target")
    days = sell.get("days")
    trades: list[dict] = []
    i = 0
    n = len(bars)
    while i < n - 1:
        if not sig[i] or bars[i].day < since:
            i += 1
            continue
        e = i + 1
        entry = bars[e].open or bars[e].close
        if not entry or entry <= 0:
            i += 1
            continue
        lo_px = entry * (1 - stop / 100) if stop else None
        hi_px = entry * (1 + target / 100) if target else None
        x, px, why = None, None, ""
        for j in range(e, min(n, e + MAX_HOLD)):
            b = bars[j]
            o = b.open if (b.open and j > e) else None  # 산 날은 시가에 샀으니 갭은 다음 날부터
            low = b.low if b.low is not None else b.close
            high = b.high if b.high is not None else b.close
            if lo_px is not None and low <= lo_px:
                x, px, why = j, min(o, lo_px) if o else lo_px, "손절"
                break
            if hi_px is not None and high >= hi_px:
                x, px, why = j, max(o, hi_px) if o else hi_px, "익절"
                break
            if ma20 is not None and ma20[j] is not None and b.close < ma20[j]:
                x, px, why = j, b.close, "20일선 이탈"
                break
            if days and j - e + 1 >= days:
                x, px, why = j, b.close, f"{days}일 뒤"
                break
        if x is None:
            x = min(n - 1, e + MAX_HOLD - 1)
            px = bars[x].close
            why = "기간 끝" if x == n - 1 else "너무 오래 들고 있어서"
        r = (px / entry - 1) * 100 - COST
        h = min(n - 1, e + HOLD_DAYS - 1)
        hold = (bars[h].close / entry - 1) * 100 - COST
        trades.append({"b": bars[e].day.isoformat(), "s": bars[x].day.isoformat(), "bp": round(entry, 4), "sp": round(px, 4),
                       "r": round(r, 2), "d": x - e + 1, "why": why, "hold": round(hold, 2)})
        i = x + 1
    return trades


def histogram(returns: list[float]) -> list[int]:
    """BINS 경계로 나눈 개수. 맨 앞은 -20% 아래, 맨 뒤는 +20% 넘게."""
    out = [0] * (len(BINS) + 1)
    for r in returns:
        k = 0
        while k < len(BINS) and r >= BINS[k]:
            k += 1
        out[k] += 1
    return out


def summarize(trades: list[dict]) -> dict:
    rs = [t["r"] for t in trades]
    n = len(rs)
    if not n:
        return {"n": 0, "wins": 0, "winPct": None, "avg": None, "worst": None, "best": None, "avgDays": None, "hold": None,
                "avgWin": None, "avgLoss": None, "hist": histogram([]), "bins": BINS}
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]
    mean = lambda xs: round(sum(xs) / len(xs), 2) if xs else None  # noqa: E731
    return {
        "n": n, "wins": len(wins), "winPct": round(len(wins) / n * 100, 1), "avg": mean(rs), "worst": min(rs), "best": max(rs),
        "avgDays": round(sum(t["d"] for t in trades) / n, 1), "hold": mean([t["hold"] for t in trades]),
        "avgWin": mean(wins), "avgLoss": mean(losses), "hist": histogram(rs), "bins": BINS,
    }


def keep_trades(trades: list[dict], cap: int = MAX_TRADES) -> list[dict]:
    """많으면 가장 크게 잃은·번 거래를 먼저 남기고 나머지는 최근 것부터."""
    if len(trades) <= cap:
        return sorted(trades, key=lambda t: t["b"], reverse=True)
    by_r = sorted(trades, key=lambda t: t["r"])
    edge = cap // 10
    picked = {id(t) for t in by_r[:edge] + by_r[-edge:]}
    rest = [t for t in sorted(trades, key=lambda t: t["b"], reverse=True) if id(t) not in picked]
    out = by_r[:edge] + by_r[-edge:] + rest[: cap - 2 * edge]
    return sorted(out, key=lambda t: t["b"], reverse=True)


def backtest(universe: list[tuple[str, str, str, list[Bar]]], rule: dict, today: date) -> dict:
    """universe: (ticker, name, market, 일봉). 결과 dict(요약 + 거래 + 기간)."""
    since = today - timedelta(days=365 * rule["years"])
    trades: list[dict] = []
    tickers = 0
    for ticker, name, market, bars in universe:
        if rule["market"] != "ALL" and market != rule["market"]:
            continue
        tickers += 1
        for t in run_ticker(bars, rule, since):
            t.update({"t": ticker, "n": name, "m": market})
            trades.append(t)
    out = summarize(trades)
    out.update({"tickers": tickers, "since": since.isoformat(), "until": today.isoformat(), "trades": keep_trades(trades),
                "kept": min(len(trades), MAX_TRADES)})
    return out


# ---------------------------------------------------------------- AI: 한 줄 → 칸
PARSE_SYSTEM = """너는 주식 매매 규칙 문장을 정해진 칸으로만 옮기는 도우미야. JSON 하나만 답해.
고를 수 있는 칸:
- buy (모두 true/false): ma20(종가가 20일 이동평균선 위), rsi30(RSI14가 30 아래), high52(52주 신고가), vol2(거래량이 20일 평균의 2배 이상), support(지난 60일 최저가 근처까지 내려왔다가 그 위에서 마감)
- sell: stop(손절 %, 양수), target(익절 %, 양수), days(며칠 뒤 판다, 거래일), ma20break(종가가 20일선 아래로 내려가면 판다, true/false)
- market: "KR"(국내) | "US"(미국) | "ALL"(둘 다, 말이 없으면)
- years: 1 | 3 | 5 (말이 없으면 5)
- unsupported: 위 칸으로 못 옮긴 말을 짧은 한국어 조각으로 (없으면 [])
- name: 규칙 이름, 한국어 10자 안쪽
예: {"buy":{"ma20":true,"rsi30":true,"high52":false,"vol2":false,"support":false},"sell":{"stop":7,"target":15,"days":null,"ma20break":false},"market":"ALL","years":5,"unsupported":[],"name":"눌림목 RSI"}"""


def parse_answer(text: str) -> dict:
    """AI 답에서 JSON을 꺼내 정리해요. 칸이 하나도 안 맞으면 rule=None."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("AI 답에서 규칙을 못 찾았어요")
    data = json.loads(m.group(0))
    unsupported = [str(x)[:60] for x in data.get("unsupported") or [] if str(x).strip()][:6]
    name = str(data.get("name") or "").strip()[:20]
    buy = data.get("buy") if isinstance(data.get("buy"), dict) else {}
    sell = data.get("sell") if isinstance(data.get("sell"), dict) else {}
    loose = {"buy": {k: bool(buy.get(k)) for k in BUY_KEYS}, "sell": {k: sell.get(k) for k in ("stop", "target", "days", "ma20break")},
             "market": data.get("market"), "years": data.get("years")}
    try:
        rule = clean_rule(loose)
    except ValueError as e:
        rule, unsupported = None, unsupported + [str(e)]
        partial = loose
    else:
        partial = rule
    return {"rule": rule, "partial": partial, "unsupported": unsupported, "name": name}


# ---------------------------------------------------------------- DB
def load_universe(conn: psycopg.Connection, market: str, since: date) -> list[tuple[str, str, str, list[Bar]]]:
    rows = conn.execute(
        """SELECT p.ticker, p.name, p.market, h.day, h.open, h.high, h.low, h.close, h.volume
           FROM practice_pool p JOIN price_history h ON h.ticker = p.ticker
           WHERE (%s = 'ALL' OR p.market = %s) AND h.day >= %s
           ORDER BY p.ticker, h.day""",
        (market, market, since),
    )
    out: list[tuple[str, str, str, list[Bar]]] = []
    cur = None
    for t, name, m, d, o, hi, lo, c, v in rows:
        if cur is None or cur[0] != t:
            cur = (t, name, m, [])
            out.append(cur)
        f = lambda x: float(x) if x is not None else None  # noqa: E731
        cur[3].append(Bar(d, f(o), f(hi), f(lo), float(c), f(v)))
    return out


class LabWorker:
    def __init__(self, cfg: Config, http: httpx.Client):
        self.http = http
        self.key, self.model, self.ask = ai.text_asker(cfg)

    def run_once(self, conn: psycopg.Connection, today: date | None = None) -> bool:
        did = self.parse(conn)
        row = conn.execute(
            "SELECT id, rule FROM lab_rules WHERE status = 'queued' ORDER BY asked_at LIMIT 1").fetchone()
        if not row:
            return did
        rid, raw = row
        conn.execute("UPDATE lab_rules SET status = 'running', error = NULL WHERE id = %s", (rid,))
        try:
            rule = clean_rule(raw)
            today = today or datetime.now(timezone.utc).date()
            uni = load_universe(conn, rule["market"], today - timedelta(days=365 * rule["years"] + WARMUP * 2))
            if not uni:
                raise ValueError("연습용 일봉이 아직 없어요. 워커가 받는 중이에요")
            t0 = time.monotonic()
            res = backtest(uni, rule, today)
            res["seconds"] = round(time.monotonic() - t0, 1)
            conn.execute("UPDATE lab_rules SET status = 'done', result = %s, done_at = now() WHERE id = %s", (json.dumps(res), rid))
            log.info("실험실 규칙 %s: %s종목 거래 %s번 (%.1f초)", rid, res["tickers"], res["n"], res["seconds"])
        except Exception as e:
            log.warning("실험실 규칙 %s 돌리기 실패: %s", rid, e)
            conn.execute("UPDATE lab_rules SET status = 'error', error = %s, done_at = now() WHERE id = %s", (str(e)[:300], rid))
        return True

    def parse(self, conn: psycopg.Connection) -> bool:
        req = db.get_setting(conn, "lab_parse")
        if not (isinstance(req, dict) and req.get("status") == "pending"):
            return False
        out = dict(req)
        if not self.ask:
            out.update(status="error", error="AI 키(GEMINI_API_KEY)가 없어서 칸을 못 채워요")
        else:
            try:
                text = self.ask(PARSE_SYSTEM, f"규칙 문장: {str(req.get('text') or '')[:400]}", self.key, self.model, self.http, ai.LONG + 1)  # lite 모델로 안 넘어가게
                out.update(status="done", **parse_answer(text))
            except Exception as e:
                log.warning("실험실 한 줄 규칙 바꾸기 실패: %s", e)
                out.update(status="error", error=str(e)[:200])
        db.set_setting(conn, "lab_parse", out)
        return True


def loop(cfg: Config, db_conn) -> None:
    worker = LabWorker(cfg, httpx.Client(timeout=60))
    while True:
        try:
            while worker.run_once(db_conn.get()):
                pass
        except Exception:
            log.exception("실험실 처리 실패")
            db_conn.check()
        time.sleep(POLL_SECONDS)


def start(cfg: Config, db_conn) -> None:
    threading.Thread(target=loop, args=(cfg, db_conn), name="lab", daemon=True).start()
