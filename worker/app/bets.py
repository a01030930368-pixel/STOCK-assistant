"""실적 예측 내기.

실적 발표 전에 사용자가 적은 예측(earnings_bets: 매출·영업이익이 시장 예상보다 높다/비슷/낮다, 다음 날 주가 오른다/내린다, 확신)을
발표 뒤에 채점해요. 시장 예상이 있으면 "실제가 예상보다 ±2% 넘게 높았나/낮았나"로, 없으면 적어 둔 숫자와 5% 안이면 맞힌 걸로 봐요.
텔레그램: 발표 3일 전에 "예측해 볼까요?"(이미 적었으면 다시 보기), 채점이 끝나면 결과를 보내요.
"""
from bisect import bisect_left, bisect_right
from datetime import date, timedelta

import psycopg
from psycopg.types.json import Jsonb

SAME_BAND = 2.0  # 예상과 이만큼(%) 안이면 "비슷"
NEAR = 5.0  # 시장 예상이 없을 때 내 숫자와 이만큼(%) 안이면 맞힘
PRE_DAYS = 3  # 발표 이만큼 전에 알려요
PX_WAIT = 7  # 발표 뒤 이만큼 지나도 주가가 없으면 주가는 빼고 채점해요
DIRS = ("up", "same", "down")
WORD = {"up": "높다", "same": "비슷", "down": "낮다"}
PX_WORD = {"up": "오른다", "down": "내린다"}


def quarter_word(period: str) -> str:
    return f"{period[2:4]}년 {period[5:]}분기"


def next_period(period: str) -> str:
    y, q = int(period[:4]), int(period[5:])
    return f"{y + 1}Q1" if q == 4 else f"{y}Q{q + 1}"


def last_ended(today: date) -> str:
    q = (today.month - 1) // 3  # 지금 분기 바로 앞 분기
    return f"{today.year - 1}Q4" if q == 0 else f"{today.year}Q{q}"


def target_period(reported: list[str], today: date) -> str:
    """예측할 분기: 마지막으로 발표된 분기의 다음 분기. 발표 기록이 없으면 막 끝난 분기."""
    return next_period(max(reported)) if reported else last_ended(today)


def direction(actual: float, ref: float, band: float = SAME_BAND) -> str:
    pct = (actual / ref - 1) * 100 if ref else 0.0
    if ref < 0:  # 적자 예상이면 부호를 뒤집어 "더 좋다/나쁘다"로
        pct = -pct
    return "up" if pct > band else "down" if pct < -band else "same"


def judge_item(guess: str | None, mine: float | None, actual: float | None, est: float | None) -> dict | None:
    """한 문제 채점. 답을 안 했으면 None, 실제 숫자가 없으면 ok=None(채점 불가)."""
    if guess not in DIRS and mine is None:
        return None
    out = {"guess": guess, "mine": mine, "actual": actual, "est": est, "ok": None, "by": ""}
    if actual is None:
        return out
    if est and guess in DIRS:
        got = direction(actual, est)
        out.update(ok=got == guess, got=got, pct=round((actual / est - 1) * 100, 2), by="consensus")
    elif mine:
        gap = abs(actual / mine - 1) * 100
        out.update(ok=gap <= NEAR, pct=round((actual / mine - 1) * 100, 2), by="mine")
    return out


def judge_px(guess: str | None, pct: float | None) -> dict | None:
    if guess not in PX_WORD:
        return None
    return {"guess": guess, "actual": None if pct is None else round(pct, 2), "ok": None if pct is None else (pct > 0) == (guess == "up")}


def reaction(closes: list[tuple[date, float]], day: date, hour: str | None = None) -> float | None:
    """발표 전 마지막 종가 → 반응한 첫 거래일 종가(%). 미국 개장 전(bmo) 발표는 그날이 첫 반응."""
    days = [d for d, _ in closes]
    i = bisect_left(days, day) - 1  # 발표일 전 마지막 거래일
    j = bisect_left(days, day) if hour == "bmo" else bisect_right(days, day)
    if i < 0 or j >= len(closes) or not closes[i][1]:
        return None
    return (closes[j][1] / closes[i][1] - 1) * 100


def score(bet: dict, actual: dict, est: dict, px: float | None) -> dict:
    """bet: rev_dir, rev_value, op_dir, op_value, px_dir. actual/est: {rev, op}."""
    items = {
        "rev": judge_item(bet.get("rev_dir"), bet.get("rev_value"), actual.get("rev"), est.get("rev")),
        "op": judge_item(bet.get("op_dir"), bet.get("op_value"), actual.get("op"), est.get("op")),
        "px": judge_px(bet.get("px_dir"), px),
    }
    items = {k: v for k, v in items.items() if v is not None}
    done = [v for v in items.values() if v["ok"] is not None]
    return {**items, "hits": sum(1 for v in done if v["ok"]), "total": len(done)}


def score_text(name: str, period: str, result: dict, confidence: int) -> str:
    mark = lambda v: "✓" if v["ok"] else "✗" if v["ok"] is False else "·"  # noqa: E731
    parts = []
    for k, label in (("rev", "매출"), ("op", "영업이익"), ("px", "주가")):
        if k in result:
            parts.append(f"{label} {mark(result[k])}")
    lines = [f"🎯 {name} {quarter_word(period)} 실적 예측 채점이 나왔어요", " · ".join(parts),
             f"{result['total']}문제 중 {result['hits']}개 맞힘 (확신 {confidence}%)"]
    if "px" in result and result["px"]["actual"] is not None:
        lines.append(f"다음 날 주가 {result['px']['actual']:+.1f}%")
    lines.append("앱 › 기업 공부 › 가설 탭에서 내 예측 성적을 볼 수 있어요.")
    return "\n".join(lines)


def pre_text(name: str, period: str, day: date, has_bet: bool) -> str:
    if has_bet:
        return (f"🎯 {name} {quarter_word(period)} 실적이 {day:%m.%d}에 나와요\n"
                "적어 둔 예측을 한 번 더 볼까요? 발표 전까지 고칠 수 있어요.\n앱 › 기업 공부 › 가설 탭")
    return (f"🎯 {name} {quarter_word(period)} 실적이 {day:%m.%d}에 나와요\n"
            "매출·영업이익이 시장 예상보다 높을지, 다음 날 주가는 어떨지 미리 적어 볼까요?\n앱 › 기업 공부 › 가설 탭")


# ---------------------------------------------------------------- DB

def reported_periods(conn: psycopg.Connection, ticker: str) -> list[str]:
    return [r[0] for r in conn.execute(
        """SELECT period FROM earnings_filings WHERE ticker = %s UNION SELECT period FROM earnings_reports WHERE ticker = %s""",
        (ticker, ticker)).fetchall()]


def first_day(conn: psycopg.Connection, ticker: str, period: str) -> tuple[date | None, str | None]:
    row = conn.execute(
        """SELECT min(d) FROM (SELECT reported_on AS d FROM earnings_reports WHERE ticker = %s AND period = %s
             UNION ALL SELECT day FROM earnings_filings WHERE ticker = %s AND period = %s
             UNION ALL SELECT reported_on FROM earnings_estimates WHERE ticker = %s AND period = %s) x""",
        (ticker, period, ticker, period, ticker, period)).fetchone()
    hour = conn.execute("SELECT hour FROM earnings_estimates WHERE ticker = %s AND period = %s", (ticker, period)).fetchone()
    return (row[0] if row else None), (hour[0] if hour else None)


def actuals(conn: psycopg.Connection, ticker: str, period: str, numbers: dict[str, dict[str, float]]) -> dict:
    q = numbers.get(period, {})
    rev, op = q.get("revenue"), q.get("operating_income")
    if rev is None:
        r = conn.execute("SELECT revenue_actual FROM earnings_estimates WHERE ticker = %s AND period = %s", (ticker, period)).fetchone()
        rev = float(r[0]) if r and r[0] is not None else None
    return {"rev": rev, "op": op}


def consensus(conn: psycopg.Connection, ticker: str, period: str, snap_rev, snap_op) -> dict:
    r = conn.execute("SELECT revenue_estimate, op_estimate FROM earnings_estimates WHERE ticker = %s AND period = %s", (ticker, period)).fetchone()
    f = lambda v: None if v is None else float(v)  # noqa: E731
    return {"rev": f(r[0]) if r and r[0] is not None else f(snap_rev), "op": f(r[1]) if r and r[1] is not None else f(snap_op)}


def closes(conn: psycopg.Connection, ticker: str, since: date) -> list[tuple[date, float]]:
    return [(d, float(c)) for d, c in conn.execute(
        "SELECT day, close FROM price_history WHERE ticker = %s AND day >= %s ORDER BY day", (ticker, since))]


def run_scoring(conn: psycopg.Connection, numbers_of, today: date) -> int:
    """발표가 난 분기의 예측을 채점해요. numbers_of(ticker) → 분기 숫자(thesis.quarter_numbers)."""
    done = 0
    for ticker, period, *rest in conn.execute(
            """SELECT ticker, period, rev_dir, rev_value, op_dir, op_value, px_dir, est_rev, est_op FROM earnings_bets
               WHERE scored_at IS NULL ORDER BY ticker, period""").fetchall():
        rev_dir, rev_value, op_dir, op_value, px_dir, est_rev, est_op = rest
        day, hour = first_day(conn, ticker, period)
        if day is None:
            continue
        act = actuals(conn, ticker, period, numbers_of(ticker))
        if act["rev"] is None and act["op"] is None:
            continue
        px = reaction(closes(conn, ticker, day - timedelta(days=15)), day, hour)
        if px is None and px_dir and today < day + timedelta(days=PX_WAIT):
            continue  # 다음 날 주가가 들어오면 같이 채점해요
        bet = {"rev_dir": rev_dir, "rev_value": None if rev_value is None else float(rev_value),
               "op_dir": op_dir, "op_value": None if op_value is None else float(op_value), "px_dir": px_dir}
        result = score(bet, act, consensus(conn, ticker, period, est_rev, est_op), px)
        result["day"] = day.isoformat()
        conn.execute("UPDATE earnings_bets SET result = %s, scored_at = now() WHERE ticker = %s AND period = %s",
                     (Jsonb(result), ticker, period))
        done += 1
    return done


def notices(conn: psycopg.Connection, today: date, queue) -> None:
    """queue(key, text): ThesisJob 텔레그램 대기열(알림 시간에만 보내요)."""
    for ticker, name, day in conn.execute(
            """SELECT DISTINCT c.ticker, n.name, c.day FROM calendar_events c JOIN study_notes n ON n.ticker = c.ticker
               WHERE c.kind = 'earnings' AND c.day > %s AND c.day <= %s AND n.status <> '탈락'""",
            (today, today + timedelta(days=PRE_DAYS))).fetchall():
        period = target_period(reported_periods(conn, ticker), today)
        has = conn.execute("SELECT 1 FROM earnings_bets WHERE ticker = %s AND period = %s", (ticker, period)).fetchone() is not None
        queue(f"bet-pre:{ticker}:{day}", pre_text(name, period, day, has))
    for ticker, period, result, conf, name in conn.execute(
            """SELECT b.ticker, b.period, b.result, b.confidence, COALESCE(n.name, b.ticker) FROM earnings_bets b
               LEFT JOIN study_notes n ON n.ticker = b.ticker WHERE b.scored_at IS NOT NULL AND NOT b.notified""").fetchall():
        if result and result.get("total"):
            queue(f"bet-score:{ticker}:{period}", score_text(name, period, result, conf))
        conn.execute("UPDATE earnings_bets SET notified = true WHERE ticker = %s AND period = %s", (ticker, period))
