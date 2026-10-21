"""보유 종목(국내·ISA)의 DART 공시. 주가에 크게 닿을 수 있는 공시만 텔레그램으로 바로 알려요.

DART 목록에는 접수 날짜만 있고 시각은 없어서, 처음 본 시각(seen_at)을 같이 적어 둡니다.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime

import httpx

from .research import _dart_json

VIEW = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={}"


@dataclass(frozen=True)
class Kind:
    key: str
    label: str  # 화면 배지
    important: bool  # 텔레그램으로 바로 알리나
    icon: str
    explain: str  # 알림에 붙는 한 줄 풀이


# 위에서부터 먼저 맞는 것을 씁니다. 같은 제목에 여러 낱말이 있으면(예: 유상증자 + 정정) 위의 것이 이겨요.
KINDS = [
    (re.compile(r"매매거래정지|상장폐지|관리종목|불성실공시"), Kind("halt", "거래 주의", True, "🛑", "거래가 멈추거나 상장 유지에 문제가 생길 수 있는 공시예요.")),
    (re.compile(r"유상증자"), Kind("rights", "유상증자", True, "⚠️", "회사가 새 주식을 팔아 돈을 모아요. 주식 수가 늘어 주가가 흔들릴 수 있어요.")),
    (re.compile(r"전환사채|신주인수권|교환사채"), Kind("cb", "사채", True, "⚠️", "나중에 주식으로 바뀔 수 있는 빚이에요. 바뀌면 주식 수가 늘어요.")),
    (re.compile(r"감자"), Kind("reduce", "감자", True, "⚠️", "주식 수를 줄여요. 왜 줄이는지 공시에서 꼭 확인해 보세요.")),
    (re.compile(r"무상증자"), Kind("bonus", "무상증자", True, "🎁", "주주에게 새 주식을 공짜로 나눠 줘요. 그만큼 주가는 낮게 조정돼요.")),
    (re.compile(r"합병|분할"), Kind("merge", "합병·분할", True, "🔀", "회사를 합치거나 나눠요. 주식이 바뀌는 조건을 확인해 보세요.")),
    (re.compile(r"영업\(잠정\)실적|매출액또는손익구조"), Kind("earnings", "실적", True, "📊", "실적이 나왔어요. 1년 전과 비교한 숫자가 공시에 있어요.")),
    (re.compile(r"단일판매|공급계약"), Kind("contract", "계약", True, "🤝", "큰 계약을 맺었어요. 계약 금액과 기간은 공시에서 볼 수 있어요.")),
    (re.compile(r"최대주주\s*변경"), Kind("owner", "최대주주", True, "👤", "회사의 주인이 바뀌어요.")),
    (re.compile(r"자기주식|자사주"), Kind("buyback", "자사주", True, "🔁", "회사가 자기 주식을 사거나 팔거나 없애요.")),
    (re.compile(r"배당"), Kind("dividend", "배당", True, "💰", "배당을 정했어요. 금액과 기준일은 공시에서 볼 수 있어요.")),
    (re.compile(r"소송"), Kind("lawsuit", "소송", True, "⚖️", "회사가 소송을 당했거나 걸었어요.")),
    (re.compile(r"조회공시"), Kind("inquiry", "조회공시", True, "❓", "주가가 크게 움직여 거래소가 이유를 물었거나 회사가 답했어요.")),
    (re.compile(r"임원ㆍ주요주주|주식등의대량보유|최대주주등소유주식"), Kind("stake", "지분", False, "👤", "임원이나 큰 주주의 주식 수가 바뀌었어요.")),
]
OTHER = Kind("other", "기타", False, "📄", "")


def classify(title: str) -> Kind:
    for pattern, kind in KINDS:
        if pattern.search(title):
            return kind
    return OTHER


@dataclass(frozen=True)
class Disclosure:
    rcept_no: str
    ticker: str
    name: str
    title: str
    filer: str
    day: date

    @property
    def kind(self) -> Kind:
        return classify(self.title)

    @property
    def url(self) -> str:
        return VIEW.format(self.rcept_no)


def fetch(ticker: str, name: str, corp_code: str, key: str, since: date, today: date, http: httpx.Client) -> list[Disclosure]:
    body = _dart_json(http, "list.json", {
        "crtfc_key": key, "corp_code": corp_code, "bgn_de": since.strftime("%Y%m%d"), "end_de": today.strftime("%Y%m%d"),
        "page_count": "100",
    })
    return [
        Disclosure(r["rcept_no"], ticker, name, " ".join(r["report_nm"].split()), r.get("flr_nm", ""),
                   datetime.strptime(r["rcept_dt"], "%Y%m%d").date())
        for r in body.get("list", [])
    ]


def message(d: Disclosure) -> str:
    k = d.kind
    lines = [f"{k.icon} {d.name} · {k.label} 공시", "", f"📄 {d.title}"]
    if k.explain:
        lines.append(k.explain)
    lines += ["", f"🔗 {d.url}"]
    return "\n".join(lines)
