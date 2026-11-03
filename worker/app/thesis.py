"""기업 공부 가설 추적.

- 가설: 공부 노트에 "확인할 수 있는 문장 + 기준 + 날짜"로 적어 둔 내 생각(study_theses).
- 근거: 새 실적·공시·뉴스가 오면 AI가 어느 가설과 관련 있는지, 편드는지 반대하는지 붙여요(study_evidence).
  기준을 숫자(영업이익률 30% 이상 등)로 적은 가설은 분기 숫자가 나올 때 앱이 직접 맞춰 봐요.
- 판정: AI·숫자는 "맞아 가는 중 / 흔들림"을 제안만 하고, 정하는 건 사용자예요.
- 실적 날 점검: 실적이 나오면 종목:분기 한 줄(study_reviews)을 만들고 텔레그램으로 알려요.
- 지난 실적 발표: 공부 중인 종목은 3년 치 실적 발표 목록(earnings_filings)을 모아 둬요.
"""
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import httpx
import psycopg
from psycopg.types.json import Jsonb

from . import ai, bets, earnings, estimates, research, telegram
from .config import Config
from .market import KST
from .study import _json, _s

log = logging.getLogger("worker")

EVERY = timedelta(minutes=10)
SCAN_GAP = timedelta(hours=3)  # 같은 종목은 이만큼에 한 번만 AI에게 근거를 물어요(새 실적이면 바로)
SCAN_PER_RUN = 2  # 한 번에 AI에게 묻는 종목 수(무료 한도 아끼기)
FIRST_LOOK = timedelta(days=30)  # 새 가설은 최근 한 달 치 자료부터 봐요
REVIEW_DAYS = 10  # 발표가 이 안이면 실적 날 점검을 만들어요
FILING_YEARS = 3
ACTIVE_HOURS = (8, 22)  # 텔레그램은 이 시간(한국)에만 보내요
OPEN = ("watch", "ok", "bad")
WORD = {"watch": "지켜보는 중", "ok": "맞아 가는 중", "bad": "흔들림", "right": "맞음", "wrong": "틀림"}

# 숫자로 확인하는 가설. 값은 모두 %.
METRICS = {
    "opm": "영업이익률", "gpm": "매출총이익률", "npm": "순이익률",
    "rev_yoy": "매출 성장률(1년 전 같은 분기 대비)", "op_yoy": "영업이익 성장률(1년 전 같은 분기 대비)", "debt": "부채비율",
}


# ---------------------------------------------------------------- 지난 실적 발표 목록

@dataclass
class Filing:
    ticker: str
    day: date
    period: str
    title: str
    url: str
    source: str  # dart_prelim, dart_report, sec_8k, sec_10q, sec_10k


REPORT_TITLE = re.compile(r"(분기|반기|사업)보고서\s*\((\d{4})\.(\d{2})\)")
DART_VIEW = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={}"


def quarter_of(day: date) -> str:
    """그 날짜가 들어 있는 분기(2025-09-30 → 2025Q3)."""
    return f"{day.year}Q{(day.month - 1) // 3 + 1}"


def kr_filings(ticker: str, rows: list[dict]) -> list[Filing]:
    """DART 공시 목록에서 잠정실적과 정기보고서만. 같은 분기·종류는 처음 낸 것 하나(정정 공시는 빼요)."""
    out: dict[tuple[str, str], Filing] = {}
    for r in sorted(rows, key=lambda r: r.get("rcept_dt", "")):
        title = " ".join(str(r.get("report_nm", "")).split())
        try:
            day = datetime.strptime(r["rcept_dt"], "%Y%m%d").date()
        except (KeyError, ValueError):
            continue
        if "정정" in title:
            continue
        if earnings.PRELIMINARY.search(title):
            period, source = earnings.kr_period(day), "dart_prelim"
        elif m := REPORT_TITLE.search(title):
            month = int(m[3])
            if month not in (3, 6, 9, 12):
                continue  # 결산월이 다른 회사의 보고서는 분기를 맞추기 어려워요
            period, source = f"{m[2]}Q{month // 3}", "dart_report"
        else:
            continue
        out.setdefault((period, source), Filing(ticker, day, period, title, DART_VIEW.format(r["rcept_no"]), source))
    return list(out.values())


SEC_FORMS = {"10-Q": "sec_10q", "10-K": "sec_10k", "20-F": "sec_10k", "40-F": "sec_10k"}


def sec_filings(ticker: str, cik: int, body: dict, since: date) -> list[Filing]:
    """SEC 제출 목록에서 실적 8-K(항목 2.02)와 10-Q·10-K. 8-K는 발표일 바로 앞 분기 실적으로 봐요."""
    recent = (body.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    out = []
    for i, form in enumerate(forms):
        try:
            day = date.fromisoformat(recent["filingDate"][i])
        except (KeyError, IndexError, ValueError):
            continue
        if day < since:
            continue
        items = (recent.get("items") or [""] * len(forms))[i] or ""
        acc = recent["accessionNumber"][i]
        url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{acc}-index.htm"
        if form == "8-K" and "2.02" in items:
            out.append(Filing(ticker, day, earnings.kr_period(day), "실적 발표(8-K)", url, "sec_8k"))
        elif form in SEC_FORMS:
            try:
                end = date.fromisoformat((recent.get("reportDate") or [""] * len(forms))[i])
            except ValueError:
                continue
            word = "분기 보고서(10-Q)" if form == "10-Q" else f"연간 보고서({form})"
            out.append(Filing(ticker, day, quarter_of(end), word, url, SEC_FORMS[form]))
    return out


def dart_filing_rows(corp: str, key: str, since: date, today: date, http: httpx.Client, pages: int = 5) -> list[dict]:
    """정기공시(A: 분기·반기·사업보고서)와 거래소공시(I: 잠정실적)만 받아요. 다른 공시가 많은 회사도 3년 치가 들어오게요."""
    rows: list[dict] = []
    for kind in ("A", "I"):
        for page in range(1, pages + 1):
            body = research._dart_json(http, "list.json", {
                "crtfc_key": key, "corp_code": corp, "bgn_de": since.strftime("%Y%m%d"), "end_de": today.strftime("%Y%m%d"),
                "pblntf_ty": kind, "page_count": "100", "page_no": str(page),
            })
            rows += body.get("list") or []
            if page >= int(body.get("total_page") or 1):
                break
    return rows


def sec_submissions(cik: int, user_agent: str, http: httpx.Client) -> dict:
    res = http.get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", headers={"User-Agent": user_agent})
    res.raise_for_status()
    return res.json()


def save_filings(conn: psycopg.Connection, rows: list[Filing]) -> None:
    for f in rows:
        conn.execute(
            """INSERT INTO earnings_filings (ticker, day, period, title, url, source) VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (ticker, url) DO UPDATE SET day = EXCLUDED.day, period = EXCLUDED.period, title = EXCLUDED.title""",
            (f.ticker, f.day, f.period, f.title, f.url, f.source),
        )


# ---------------------------------------------------------------- 분기 숫자

def prev_year(period: str) -> str:
    return f"{int(period[:4]) - 1}{period[4:]}"


def quarter_numbers(statements: list[tuple], reports: list[tuple]) -> dict[str, dict[str, float]]:
    """{2026Q3: {revenue, operating_income, …}}. 재무제표 분기 값이 기본이고, 아직 없는 분기는 실적 발표(잠정) 숫자로 채워요."""
    out: dict[str, dict[str, float]] = {}
    for period, data in reports:
        for item, line in ((data or {}).get("lines") or {}).items():
            if isinstance(line, dict) and line.get("cur") is not None:
                out.setdefault(period, {})[item] = float(line["cur"])
            # 잠정실적 표의 1년 전 값도 성장률 계산에 써요
            if isinstance(line, dict) and line.get("yoy") is not None:
                out.setdefault(prev_year(period), {}).setdefault(item, float(line["yoy"]))
    for period, item, value in statements:
        out.setdefault(period, {})[item] = float(value)
    return out


def _pct(a: float | None, b: float | None) -> float | None:
    return None if a is None or not b else a / b * 100


def _growth(cur: float | None, base: float | None) -> float | None:
    return None if cur is None or base is None or base <= 0 else (cur / base - 1) * 100


def metric_value(metric: str, q: dict[str, dict[str, float]], period: str) -> float | None:
    v = q.get(period, {})
    if metric == "opm":
        return _pct(v.get("operating_income"), v.get("revenue"))
    if metric == "gpm":
        return _pct(v.get("gross_profit"), v.get("revenue"))
    if metric == "npm":
        return _pct(v.get("net_income"), v.get("revenue"))
    if metric == "debt":
        return _pct(v.get("liabilities"), v.get("equity")) if (v.get("equity") or 0) > 0 else None
    item = {"rev_yoy": "revenue", "op_yoy": "operating_income"}.get(metric)
    if item:
        return _growth(v.get(item), q.get(prev_year(period), {}).get(item))
    return None


def judge(op: str, value: float, target: float) -> bool:
    return value >= target if op == ">=" else value <= target


def quarter_word(period: str) -> str:
    return f"{period[2:4]}년 {period[5:]}분기"


def metric_line(metric: str, period: str, value: float, op: str, target: float) -> str:
    ok = judge(op, value, target)
    return f"{quarter_word(period)} {METRICS[metric]} {value:.1f}% (기준 {target:g}% {'이상' if op == '>=' else '이하'}) {'✓' if ok else '✗'}"


# ---------------------------------------------------------------- AI가 근거 붙이기

SCAN_SYSTEM = """너는 한국 개인투자자가 기업 공부 노트에 적어 둔 '가설'을 새 자료와 맞춰 보는 도우미야.
규칙:
- 자료(실적·공시·뉴스)마다 어느 가설과 직접 관련 있는지만 본다. 관련 없으면 넣지 않는다. 억지로 엮지 않는다.
- sign: 가설이 맞다는 쪽이면 "up", 가설이 틀릴 수 있다는 쪽이면 "down", 관련은 있지만 어느 쪽도 아니면 "neutral".
- note: 그 자료가 가설에 무슨 뜻인지 해요체 한 문장(60자 안팎), 숫자가 있으면 넣는다.
- 근거를 하나라도 붙인 가설만 verdicts에 넣는다. status는 "ok"(맞아 가는 중) / "bad"(흔들림) / "watch"(아직 모름) 중 하나,
  why는 해요체 한두 문장. 뉴스 한 건으로 단정하지 말고, 보도·추측이면 그렇게 말한다.
- 사세요/파세요 같은 권유는 하지 않는다.
- 답은 JSON 하나만: {"links":[{"thesis":가설번호,"item":"자료번호","sign":"up|down|neutral","note":"…"}],
  "verdicts":[{"thesis":가설번호,"status":"ok|bad|watch","why":"…"}]}"""


@dataclass
class Item:
    ref: str  # d:접수번호, e:실적id, n:뉴스해시, f:공시주소
    day: date
    text: str
    url: str

    @property
    def kind(self) -> str:
        return {"d": "disclosure", "e": "earnings", "n": "news", "f": "filing"}[self.ref[0]]


def scan_prompt(name: str, theses: list[tuple], items: list[Item]) -> str:
    """theses: [(id, 제목, 확인 기준)]"""
    lines = [f"회사: {name}", "", "가설:"]
    lines += [f"- {tid}. {title}" + (f" (확인 기준: {rule})" if rule else "") for tid, title, rule in theses]
    lines += ["", "새 자료:"]
    lines += [f"- i{n + 1}. [{it.day:%Y-%m-%d}] {it.text}" for n, it in enumerate(items)]
    return "\n".join(lines)


def parse_scan(text: str, thesis_ids: set[int], items: list[Item]) -> tuple[list[dict], dict[int, dict]]:
    """(근거 [{thesis, item(Item), sign, note}], {가설: {status, why}}). 모르는 번호·값은 버려요."""
    d = _json(text)
    refs = {f"i{n + 1}": it for n, it in enumerate(items)}
    links, seen = [], set()
    for x in d.get("links") or []:
        if not isinstance(x, dict):
            continue
        try:
            tid = int(x.get("thesis"))
        except (TypeError, ValueError):
            continue
        it = refs.get(str(x.get("item", "")).strip().lower())
        sign = x.get("sign") if x.get("sign") in ("up", "down", "neutral") else "neutral"
        if tid in thesis_ids and it and (tid, it.ref) not in seen:
            seen.add((tid, it.ref))
            links.append({"thesis": tid, "item": it, "sign": sign, "note": _s(x.get("note"), 160)})
    linked = {l["thesis"] for l in links}
    verdicts = {}
    for x in d.get("verdicts") or []:
        try:
            tid = int(x.get("thesis"))
        except (TypeError, ValueError, AttributeError):
            continue
        if tid in linked and x.get("status") in ("ok", "bad", "watch"):
            verdicts[tid] = {"status": x["status"], "why": _s(x.get("why"), 300)}
    return links, verdicts


def news_ref(url: str) -> str:
    return "n:" + hashlib.sha1(url.encode()).hexdigest()[:16]


def report_text(period: str, market: str, data: dict, ai_text: str) -> str:
    parts = []
    for item, label in (("revenue", "매출"), ("operating_income", "영업이익"), ("net_income", "순이익")):
        line = ((data or {}).get("lines") or {}).get(item) or {}
        if line.get("cur") is not None:
            ch = earnings.change(line.get("cur"), line.get("yoy"))
            parts.append(f"{label} {earnings.money(line['cur'], market)}" + (f"(1년 전 대비 {ch})" if ch else ""))
    head = f"{quarter_word(period)} 실적: " + ", ".join(parts) if parts else f"{quarter_word(period)} 실적 발표"
    return _s(head + (f" — {ai_text}" if ai_text else ""), 600)


# ---------------------------------------------------------------- 텔레그램 글

def bad_text(name: str, title: str, why: str, by: str) -> str:
    head = "숫자가 기준을 못 넘었어요" if by == "metric" else "새 자료가 반대쪽이에요"
    return f"⚠ {name} 가설이 흔들려요\n\"{title}\"\n→ {head}: {why}\n\n앱 › 관심종목 › 기업 공부 › 가설 탭에서 판정을 정해 주세요."


def review_text(name: str, period: str, titles: list[str]) -> str:
    lines = [f"📒 {name} {quarter_word(period)} 실적이 나왔어요", f"확인할 가설 {len(titles)}개:"]
    lines += [f"· {t}" for t in titles[:8]]
    lines.append("앱 › 기업 공부 › 가설 탭의 '실적 날 점검'에서 하나씩 맞춰 보세요.")
    return "\n".join(lines)


def eday_text(name: str, titles: list[str]) -> str:
    lines = [f"📒 오늘 {name} 실적 발표가 있어요", f"확인할 가설 {len(titles)}개:"]
    lines += [f"· {t}" for t in titles[:8]]
    lines.append("숫자가 나오면 앱이 먼저 맞춰 볼게요.")
    return "\n".join(lines)


def due_text(rows: list[tuple]) -> str:
    """rows: [(회사, 가설, 기한)]"""
    lines = ["⏰ 확인 날이 된 가설이 있어요"]
    lines += [f"· {n}: \"{t}\" ({d:%m.%d})" for n, t, d in rows[:10]]
    lines.append("맞았는지 틀렸는지 가설 탭에서 정해 주세요. 더 지켜볼 거면 날짜를 미뤄도 돼요.")
    return "\n".join(lines)


# ---------------------------------------------------------------- 일

class ThesisJob:
    def __init__(self, cfg: Config, http: httpx.Client, dart_codes=lambda: {}, sec_ciks=lambda: {}):
        self.cfg = cfg
        self.http = http
        self.dart_codes = dart_codes
        self.sec_ciks = sec_ciks
        self.last: datetime | None = None
        self.filed: dict[str, date] = {}  # 오늘 지난 실적 목록을 받아 본 종목
        self.estimated: dict[str, date] = {}  # 오늘 시장 예상치를 받아 본 종목
        self.key, self.model, self.ask = ai.text_asker(cfg)

    @property
    def user_agent(self) -> str:
        return f"STOCK-assistant {self.cfg.sec_contact_email}"

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        forced = conn.execute("SELECT value FROM app_settings WHERE key = 'thesis_scan'").fetchone()
        if not forced and self.last and now - self.last < EVERY:
            return
        self.last = now
        today = now.astimezone(KST).date()
        for step in (lambda: self.filings(conn, today), lambda: self.estimates(conn, today), lambda: self.metrics(conn, today), lambda: self.reviews(conn, today, now),
                     lambda: bets.run_scoring(conn, lambda t: self.numbers(conn, t), today), lambda: self.scan(conn, now), lambda: self.notices(conn, now)):
            try:
                step()
            except Exception:
                log.exception("기업 공부 가설 처리 실패")

    # ------------------------------------------------------------ 지난 실적 발표

    def filings(self, conn: psycopg.Connection, today: date) -> None:
        """공부 중인 종목의 3년 치 실적 발표 목록. 하루에 한 번, 한 회차에 몇 종목씩."""
        since = today.replace(year=today.year - FILING_YEARS)
        done = 0
        for ticker, market in conn.execute("SELECT ticker, market FROM study_notes WHERE status <> '탈락' ORDER BY updated_at DESC").fetchall():
            if self.filed.get(ticker) == today or done >= 3:
                continue
            try:
                if market == "KR":
                    corp = self.dart_codes().get(ticker)
                    if not (corp and self.cfg.dart_api_key):
                        continue
                    found = kr_filings(ticker, dart_filing_rows(corp, self.cfg.dart_api_key, since, today, self.http))
                else:
                    cik = self.sec_ciks().get(ticker.upper())
                    if not cik:
                        continue
                    found = sec_filings(ticker, cik, sec_submissions(cik, self.user_agent, self.http), since)
            except Exception as e:
                log.warning("%s 지난 실적 발표 목록 받기 실패: %s", ticker, e)
                self.filed[ticker] = today
                continue
            self.filed[ticker] = today
            done += 1
            save_filings(conn, found)

    def estimates(self, conn: psycopg.Connection, today: date) -> None:
        """공부 중인 종목의 시장 예상치. 하루에 한 번, 한 회차에 몇 종목씩."""
        done = 0
        for ticker, market in conn.execute("SELECT ticker, market FROM study_notes WHERE status <> '탈락' ORDER BY updated_at DESC").fetchall():
            if self.estimated.get(ticker) == today or done >= 3:
                continue
            self.estimated[ticker] = today
            try:
                if market == "KR":
                    rows = estimates.naver_estimates(ticker, estimates.naver_quarter(ticker, self.http))
                elif self.cfg.finnhub_api_key:
                    rows = estimates.finnhub_estimates(ticker, *estimates.finnhub_rows(ticker, self.cfg.finnhub_api_key, today, self.http))
                else:
                    continue
            except Exception as e:
                log.warning("%s 실적 예상치 받기 실패: %s", ticker, e)
                continue
            done += 1
            estimates.save(conn, rows, today)

    # ------------------------------------------------------------ 숫자 가설

    def numbers(self, conn: psycopg.Connection, ticker: str) -> dict[str, dict[str, float]]:
        stmts = conn.execute("SELECT period, item, value FROM stock_statements WHERE ticker = %s AND kind = 'Q'", (ticker,)).fetchall()
        reps = conn.execute("SELECT period, data FROM earnings_reports WHERE ticker = %s ORDER BY reported_on", (ticker,)).fetchall()
        return quarter_numbers(stmts, reps)

    def metrics(self, conn: psycopg.Connection, today: date) -> None:
        rows = conn.execute(
            """SELECT t.id, t.ticker, t.metric, t.op, t.target, t.ai FROM study_theses t
               WHERE t.status = ANY(%s) AND t.metric IS NOT NULL AND t.op IS NOT NULL AND t.target IS NOT NULL""", (list(OPEN),),
        ).fetchall()
        cache: dict[str, dict] = {}
        for tid, ticker, metric, op, target, prev_ai in rows:
            if metric not in METRICS:
                continue
            q = cache.setdefault(ticker, self.numbers(conn, ticker))
            days = dict(conn.execute(
                "SELECT period, min(day) FROM earnings_filings WHERE ticker = %s GROUP BY period", (ticker,)).fetchall())
            target = float(target)
            got = [(p, v) for p in sorted(q) if (v := metric_value(metric, q, p)) is not None][-4:]
            for period, value in got:
                end = date(int(period[:4]), int(period[5]) * 3, 1)
                conn.execute(
                    """INSERT INTO study_evidence (thesis_id, day, kind, ref, text, sign, value) VALUES (%s, %s, 'metric', %s, %s, %s, %s)
                       ON CONFLICT (thesis_id, ref) DO UPDATE SET text = EXCLUDED.text, sign = EXCLUDED.sign, value = EXCLUDED.value""",
                    (tid, days.get(period) or end, f"m:{period}", metric_line(metric, period, value, op, target),
                     "up" if judge(op, value, target) else "down", round(value, 2)),
                )
            if not got:
                continue
            period, value = got[-1]
            if (prev_ai or {}).get("by") == "metric" and (prev_ai or {}).get("period") == period:
                continue
            ok = judge(op, value, target)
            status = "ok" if ok else "bad"
            why = metric_line(metric, period, value, op, target)
            # 처음 맞춰 볼 때(가설을 막 만든 때)는 알리지 않아요. 이미 아는 숫자일 테니까요.
            alert = status == "bad" and prev_ai is not None and prev_ai.get("status") != "bad"
            conn.execute(
                "UPDATE study_theses SET ai = %s, updated_at = now() WHERE id = %s",
                (Jsonb({"status": status, "why": why, "by": "metric", "period": period, "at": datetime.now(timezone.utc).isoformat(), "alert": alert}), tid),
            )

    # ------------------------------------------------------------ 실적 날 점검

    def reviews(self, conn: psycopg.Connection, today: date, now: datetime) -> None:
        since = today - timedelta(days=REVIEW_DAYS)
        rows = conn.execute(
            """SELECT x.ticker, x.period, min(x.day) FROM (
                 SELECT ticker, period, reported_on AS day FROM earnings_reports WHERE reported_on >= %s
                 UNION ALL SELECT ticker, period, day FROM earnings_filings WHERE day >= %s AND source IN ('dart_prelim', 'sec_8k', 'dart_report', 'sec_10q', 'sec_10k')
               ) x WHERE EXISTS (SELECT 1 FROM study_theses t WHERE t.ticker = x.ticker AND t.status = ANY(%s))
               GROUP BY x.ticker, x.period""",
            (since, since, list(OPEN)),
        ).fetchall()
        for ticker, period, day in rows:
            rid = f"{ticker}:{period}"
            if conn.execute("SELECT 1 FROM study_reviews WHERE id = %s", (rid,)).fetchone():
                continue
            conn.execute("INSERT INTO study_reviews (id, ticker, period, day) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING", (rid, ticker, period, day))
            # 새 실적이면 AI에게 바로 근거를 물어요
            request_scan(conn, ticker)
            name = conn.execute("SELECT name FROM study_notes WHERE ticker = %s", (ticker,)).fetchone()
            titles = [r[0] for r in conn.execute("SELECT title FROM study_theses WHERE ticker = %s AND status = ANY(%s) ORDER BY id", (ticker, list(OPEN)))]
            self.queue(conn, f"thesis-review:{rid}", review_text(name[0] if name else ticker, period, titles))

    # ------------------------------------------------------------ AI 근거 붙이기

    def items(self, conn: psycopg.Connection, ticker: str, market: str, since: datetime) -> list[Item]:
        out: list[Item] = []
        for rno, day, title, summary in conn.execute(
                "SELECT rcept_no, day, title, summary FROM stock_disclosures WHERE ticker = %s AND seen_at > %s ORDER BY day DESC LIMIT 15", (ticker, since)):
            out.append(Item(f"d:{rno}", day, f"[공시] {title}" + (f" — {summary}" if summary else ""), DART_VIEW.format(rno)))
        for rid, period, day, url, data, ai_text in conn.execute(
                "SELECT id, period, reported_on, url, data, ai FROM earnings_reports WHERE ticker = %s AND created_at > %s ORDER BY reported_on", (ticker, since)):
            out.append(Item(f"e:{rid}", day, "[실적] " + report_text(period, market, data, ai_text), url))
        for url, title, at in conn.execute(
                """SELECT url, COALESCE(title_ko, title), published_at FROM stock_news WHERE ticker = %s AND published_at > %s
                   ORDER BY published_at DESC LIMIT 15""", (ticker, since)):
            out.append(Item(news_ref(url), at.astimezone(KST).date(), f"[뉴스] {_s(title, 160)}", url))
        return out

    def scan(self, conn: psycopg.Connection, now: datetime) -> None:
        forced = set((conn.execute("SELECT value FROM app_settings WHERE key = 'thesis_scan'").fetchone() or [{}])[0].get("tickers") or [])
        conn.execute("DELETE FROM app_settings WHERE key = 'thesis_scan'")
        if not self.ask:
            return
        rows = conn.execute(
            """SELECT t.ticker, n.name, n.market, min(COALESCE(t.scanned_at, t.created_at - %s)), bool_or(t.scanned_at IS NULL), max(t.scanned_at)
               FROM study_theses t JOIN study_notes n ON n.ticker = t.ticker WHERE t.status = ANY(%s) AND t.metric IS NULL
               GROUP BY t.ticker, n.name, n.market""",
            (FIRST_LOOK, list(OPEN)),
        ).fetchall()
        asked = 0
        for ticker, name, market, since, fresh, last in rows:
            if asked >= SCAN_PER_RUN:
                break
            if not (fresh or ticker in forced or not last or now - last >= SCAN_GAP):
                continue
            items = self.items(conn, ticker, market, since)
            theses = conn.execute(
                """SELECT id, title, rule, ai, scanned_at IS NULL FROM study_theses
                   WHERE ticker = %s AND status = ANY(%s) AND metric IS NULL ORDER BY id""", (ticker, list(OPEN)),
            ).fetchall()
            if items:
                asked += 1
                try:
                    text = self.ask(SCAN_SYSTEM, scan_prompt(name, [t[:3] for t in theses], items), self.key, self.model, self.http, 2048)
                    links, verdicts = parse_scan(text, {t[0] for t in theses}, items)
                except Exception as e:
                    log.warning("%s 가설 근거 붙이기 실패: %s", name, e)
                    continue
                self.save_scan(conn, links, verdicts, {t[0]: t[3] for t in theses}, {t[0] for t in theses if t[4]})
            conn.execute("UPDATE study_theses SET scanned_at = %s WHERE ticker = %s AND status = ANY(%s) AND metric IS NULL", (now, ticker, list(OPEN)))

    def save_scan(self, conn: psycopg.Connection, links: list[dict], verdicts: dict[int, dict], prev: dict[int, dict | None],
                  first: set[int] = frozenset()) -> None:
        """first: 처음 살펴본 가설(막 만든 것). 지난 한 달 자료로 붙인 판정이라 텔레그램으로는 알리지 않아요."""
        for l in links:
            it: Item = l["item"]
            text = it.text + (f"\n→ {l['note']}" if l["note"] else "")
            conn.execute(
                """INSERT INTO study_evidence (thesis_id, day, kind, ref, text, url, sign) VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (thesis_id, ref) DO NOTHING""",
                (l["thesis"], it.day, it.kind, it.ref, _s(text, 800), it.url, l["sign"]),
            )
        for tid, v in verdicts.items():
            alert = v["status"] == "bad" and tid not in first and (prev.get(tid) or {}).get("status") != "bad"
            conn.execute("UPDATE study_theses SET ai = %s, updated_at = now() WHERE id = %s",
                         (Jsonb({**v, "by": "ai", "at": datetime.now(timezone.utc).isoformat(), "alert": alert}), tid))

    # ------------------------------------------------------------ 텔레그램

    def queue(self, conn: psycopg.Connection, key: str, text: str) -> None:
        """보낼 글을 쌓아 두고 알림 시간에 보내요(밤에 실적이 나와도 아침에)."""
        q = (conn.execute("SELECT value FROM app_settings WHERE key = 'thesis_outbox'").fetchone() or [[]])[0]
        if not any(x.get("key") == key for x in q):
            q.append({"key": key, "text": text})
            conn.execute("INSERT INTO app_settings (key, value) VALUES ('thesis_outbox', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                         (Jsonb(q[-20:]),))

    def notices(self, conn: psycopg.Connection, now: datetime) -> None:
        local = now.astimezone(KST)
        if not (ACTIVE_HOURS[0] <= local.hour < ACTIVE_HOURS[1]):
            return
        today = local.date()
        # 흔들리는 가설
        for tid, title, info, name in conn.execute(
                """SELECT t.id, t.title, t.ai, n.name FROM study_theses t JOIN study_notes n ON n.ticker = t.ticker
                   WHERE t.status = ANY(%s) AND (t.ai->>'alert')::boolean""", (list(OPEN),)).fetchall():
            self.queue(conn, f"thesis-bad:{tid}:{info.get('at', '')}", bad_text(name, title, info.get("why", ""), info.get("by", "ai")))
            conn.execute("UPDATE study_theses SET ai = ai || '{\"alert\": false}' WHERE id = %s", (tid,))
        # 오늘 실적 발표가 있는 종목
        for ticker, name in conn.execute(
                """SELECT DISTINCT c.ticker, n.name FROM calendar_events c JOIN study_notes n ON n.ticker = c.ticker
                   WHERE c.kind = 'earnings' AND c.day = %s AND EXISTS (SELECT 1 FROM study_theses t WHERE t.ticker = c.ticker AND t.status = ANY(%s))""",
                (today, list(OPEN))).fetchall():
            titles = [r[0] for r in conn.execute("SELECT title FROM study_theses WHERE ticker = %s AND status = ANY(%s) ORDER BY id", (ticker, list(OPEN)))]
            self.queue(conn, f"thesis-eday:{ticker}:{today}", eday_text(name, titles))
        # 실적 예측 내기: 발표 3일 전 알림, 채점 결과
        bets.notices(conn, today, lambda key, text: self.queue(conn, key, text))
        # 확인 날이 된 가설(9시 뒤 한 번에)
        if local.hour >= 9:
            due = conn.execute(
                """SELECT t.id, n.name, t.title, t.due_on FROM study_theses t JOIN study_notes n ON n.ticker = t.ticker
                   WHERE t.status = ANY(%s) AND t.due_on <= %s ORDER BY t.due_on""", (list(OPEN), today)).fetchall()
            fresh = [r for r in due if not _sent(conn, f"thesis-due:{r[0]}:{r[3]}")]
            if fresh:
                self.queue(conn, f"thesis-due:{today}", due_text([r[1:] for r in fresh]))
                for r in fresh:
                    _mark(conn, f"thesis-due:{r[0]}:{r[3]}")
        self.flush(conn)

    def flush(self, conn: psycopg.Connection) -> None:
        q = (conn.execute("SELECT value FROM app_settings WHERE key = 'thesis_outbox'").fetchone() or [[]])[0]
        if not q:
            return
        if not (self.cfg.telegram_bot_token and self.cfg.telegram_chat_id):
            conn.execute("DELETE FROM app_settings WHERE key = 'thesis_outbox'")
            return
        left = []
        for x in q:
            if _sent(conn, x["key"]):
                continue
            if telegram.deliver(self.cfg.telegram_bot_token, self.cfg.telegram_chat_id, x["text"], self.http):
                _mark(conn, x["key"])
            else:
                left.append(x)
        conn.execute("UPDATE app_settings SET value = %s WHERE key = 'thesis_outbox'", (Jsonb(left),))


def request_scan(conn: psycopg.Connection, ticker: str) -> None:
    """다음 회차에 이 종목 가설 근거를 바로 물어보게 해요(화면의 '지금 다시 보기'와 같은 자리)."""
    conn.execute(
        """INSERT INTO app_settings (key, value) VALUES ('thesis_scan', jsonb_build_object('tickers', jsonb_build_array(%s::text)))
           ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('tickers',
             COALESCE(app_settings.value->'tickers', '[]'::jsonb) || jsonb_build_array(%s::text))""", (ticker, ticker))


def _sent(conn: psycopg.Connection, key: str) -> bool:
    return conn.execute("SELECT 1 FROM notices_sent WHERE key = %s", (key,)).fetchone() is not None


def _mark(conn: psycopg.Connection, key: str) -> None:
    conn.execute("INSERT INTO notices_sent (key) VALUES (%s) ON CONFLICT DO NOTHING", (key,))
