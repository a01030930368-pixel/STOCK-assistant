"""차트 연습(관심종목 › 연습하기)에 쓸 국내·미국 큰 종목들의 일봉을 천천히 받아 둬요.

한 번 돌 때 RUN_EACH 종목씩 받아서, 처음 켠 뒤 몇 시간이면 다 채워져요. 그 뒤로는 30일에 한 번 새로 받아요.
코드가 바뀌었거나 상장 폐지된 종목은 실패로 적어 두고 30일 뒤에 다시 봐요.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import psycopg

from . import db, prices

log = logging.getLogger("worker")
KST = ZoneInfo("Asia/Seoul")
RUN_EACH = 2
REFRESH = timedelta(days=30)

KR = """005930 삼성전자,000660 SK하이닉스,373220 LG에너지솔루션,207940 삼성바이오로직스,005380 현대차,000270 기아,
068270 셀트리온,005490 POSCO홀딩스,035420 NAVER,035720 카카오,051910 LG화학,006400 삼성SDI,105560 KB금융,
055550 신한지주,012330 현대모비스,028260 삼성물산,066570 LG전자,003550 LG,032830 삼성생명,086790 하나금융지주,
015760 한국전력,017670 SK텔레콤,030200 KT,034730 SK,096770 SK이노베이션,009150 삼성전기,018260 삼성에스디에스,
010130 고려아연,011200 HMM,003670 포스코퓨처엠,033780 KT&G,316140 우리금융지주,024110 기업은행,259960 크래프톤,
012450 한화에어로스페이스,042660 한화오션,009540 HD한국조선해양,329180 HD현대중공업,010140 삼성중공업,
267260 HD현대일렉트릭,034020 두산에너빌리티,000810 삼성화재,138040 메리츠금융지주,011170 롯데케미칼,
090430 아모레퍼시픽,051900 LG생활건강,097950 CJ제일제당,271560 오리온,004020 현대제철,010950 S-Oil,
036570 엔씨소프트,251270 넷마블,352820 하이브,041510 에스엠,035900 JYP Ent.,128940 한미약품,000100 유한양행,
326030 SK바이오팜,011070 LG이노텍,034220 LG디스플레이,047050 포스코인터내셔널,161390 한국타이어앤테크놀로지,
086280 현대글로비스,000720 현대건설,006800 미래에셋증권,071050 한국금융지주,039490 키움증권,323410 카카오뱅크,
377300 카카오페이,004990 롯데지주,023530 롯데쇼핑,139480 이마트,069960 현대백화점,282330 BGF리테일,078930 GS,
001040 CJ,000880 한화,009830 한화솔루션,064350 현대로템,079550 LIG넥스원,047810 한국항공우주,272210 한화시스템,
003490 대한항공,021240 코웨이,032640 LG유플러스,036460 한국가스공사,010120 LS ELECTRIC,006260 LS,001450 현대해상,
005830 DB손해보험,000990 DB하이텍,042700 한미반도체,247540 에코프로비엠,086520 에코프로,196170 알테오젠,028300 HLB,
263750 펄어비스,293490 카카오게임즈,035760 CJ ENM,112040 위메이드,145020 휴젤,058470 리노공업,240810 원익IPS,
036930 주성엔지니어링,357780 솔브레인,005940 NH투자증권,016360 삼성증권,029780 삼성카드,000150 두산,241560 두산밥캣,
267250 HD현대,011790 SKC,002380 KCC,004370 농심,005300 롯데칠성,008770 호텔신라,035250 강원랜드,030000 제일기획,
120110 코오롱인더,185750 종근당,006280 녹십자"""

US = """AAPL Apple,MSFT Microsoft,NVDA NVIDIA,AMZN Amazon,GOOGL Alphabet,META Meta,TSLA Tesla,JPM JPMorgan,V Visa,
MA Mastercard,UNH UnitedHealth,XOM Exxon Mobil,JNJ Johnson & Johnson,PG Procter & Gamble,HD Home Depot,COST Costco,
ABBV AbbVie,MRK Merck,PEP PepsiCo,KO Coca-Cola,AVGO Broadcom,ORCL Oracle,CRM Salesforce,ADBE Adobe,NFLX Netflix,
AMD AMD,INTC Intel,QCOM Qualcomm,TXN Texas Instruments,CSCO Cisco,IBM IBM,WMT Walmart,DIS Disney,NKE Nike,
MCD McDonald's,SBUX Starbucks,BA Boeing,CAT Caterpillar,DE Deere,GE GE Aerospace,HON Honeywell,MMM 3M,
LMT Lockheed Martin,RTX RTX,UPS UPS,FDX FedEx,GS Goldman Sachs,MS Morgan Stanley,BAC Bank of America,WFC Wells Fargo,
C Citigroup,AXP American Express,BLK BlackRock,SCHW Charles Schwab,PYPL PayPal,SHOP Shopify,UBER Uber,ABNB Airbnb,
PLTR Palantir,SNOW Snowflake,CRWD CrowdStrike,PANW Palo Alto Networks,NOW ServiceNow,INTU Intuit,AMAT Applied Materials,
LRCX Lam Research,MU Micron,KLAC KLA,ASML ASML,TSM TSMC,ARM Arm,SMCI Super Micro,DELL Dell,T AT&T,VZ Verizon,
TMUS T-Mobile,CMCSA Comcast,CVX Chevron,COP ConocoPhillips,SLB SLB,OXY Occidental,PFE Pfizer,LLY Eli Lilly,
BMY Bristol-Myers,GILD Gilead,AMGN Amgen,MRNA Moderna,ISRG Intuitive Surgical,TMO Thermo Fisher,ABT Abbott,
UNP Union Pacific,F Ford,GM General Motors,RIVN Rivian,COIN Coinbase,HOOD Robinhood,SOFI SoFi,ROKU Roku,ZM Zoom,
SPOT Spotify,TGT Target,LOW Lowe's,TJX TJX,PM Philip Morris,MO Altria"""


def pool() -> list[tuple[str, str, str]]:
    """(티커, 이름, 시장) 목록. 같은 티커는 한 번만."""
    out: dict[str, tuple[str, str, str]] = {}
    for text, market in ((KR, "KR"), (US, "US")):
        for item in text.replace("\n", "").split(","):
            ticker, _, name = item.strip().partition(" ")
            if ticker:
                out.setdefault(ticker, (ticker, name.strip(), market))
    return list(out.values())


class PoolJob:
    def __init__(self, http: httpx.Client, kiwoom=None):
        self.http = http
        self.kiwoom = kiwoom
        self.seeded = False

    def run(self, conn: psycopg.Connection, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        if not self.seeded:
            db.seed_practice_pool(conn, pool())
            self.seeded = True
        kst = now.astimezone(KST)
        for ticker, market in db.practice_due(conn, now - REFRESH, RUN_EACH, kiwoom=self.kiwoom is not None):
            error = None
            try:
                rows = self.kiwoom.kr_daily(ticker, kst.strftime("%Y%m%d")) if market == "KR" else prices.us_daily(ticker, self.http)
                if not rows:
                    error = "일봉이 비어 있어요"
                else:
                    db.save_prices(conn, ticker, rows)
            except Exception as e:
                log.warning("연습용 %s 일봉 받기 실패: %s", ticker, e)
                error = str(e)[:200]
            db.practice_fetched(conn, ticker, now, error)
