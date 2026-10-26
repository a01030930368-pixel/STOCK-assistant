"""차트 연습(관심종목 › 연습하기)에 쓸 국내·미국 큰 종목들의 일봉을 천천히 받아 둬요.

한 번 돌 때 RUN_EACH 종목씩 받아서, 처음 켠 뒤 몇 시간이면 다 채워져요. 그 뒤로는 30일에 한 번 새로 받아요.
받다가 오류가 나면 RETRY 뒤에 다시 받아 보고, TRIES번 연달아 실패하거나 일봉이 비어 있으면(코드가 바뀌었거나 상장 폐지)
실패로 적어 두고 30일 뒤에 다시 봐요.
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
RETRY, TRIES = timedelta(hours=6), 3
KR_OFF = "practice_kr_off"  # 키움 키가 없어 국내 종목은 못 받는다는 표시(연습 화면이 읽어요)

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

# 더 늘린 것: 코스피 중형주와 코스닥 큰 종목
KR_MORE = """000080 하이트진로,000120 CJ대한통운,000210 DL,375500 DL이앤씨,001120 LX인터내셔널,001440 대한전선,001680 대상,
001740 SK네트웍스,002790 아모레퍼시픽홀딩스,003230 삼양식품,003410 쌍용C&E,003620 KG모빌리티,004000 롯데정밀화학,004170 신세계,
004800 효성,005070 코스모신소재,005250 녹십자홀딩스,005420 코스모화학,006360 GS건설,006650 대한유화,007070 GS리테일,
007310 오뚜기,008930 한미사이언스,009240 한샘,009420 한올바이오파마,009970 영원무역홀딩스,111770 영원무역,010060 OCI홀딩스,
010620 HD현대미포,011210 현대위아,011780 금호석유화학,012750 에스원,014680 한솔케미칼,017800 현대엘리베이터,018880 한온시스템,
020150 롯데에너지머티리얼즈,022100 포스코DX,026960 동서,028050 삼성E&A,028670 팬오션,034230 파라다이스,039130 하나투어,
042670 HD현대인프라코어,047040 대우건설,051600 한전KPS,052690 한전기술,064960 SNT모티브,069620 대웅제약,073240 금호타이어,
078340 컴투스,081660 미스토홀딩스,088350 한화생명,093370 후성,097230 HJ중공업,100090 SK오션플랜트,103140 풍산,105630 한세실업,
108670 LX하우시스,112610 씨에스윈드,114090 GKL,138930 BNK금융지주,139130 iM금융지주,175330 JB금융지주,180640 한진칼,
192820 코스맥스,204320 HL만도,214320 이노션,229640 LS에코에너지,248070 솔루엠,280360 롯데웰푸드,285130 SK케미칼,
294870 HDC현대산업개발,298020 효성티앤씨,298040 효성중공업,298050 HS효성첨단소재,302440 SK바이오사이언스,307950 현대오토에버,
336260 두산퓨얼셀,361610 SK아이이테크놀로지,383220 F&F,402340 SK스퀘어,450080 에코프로머티,454910 두산로보틱스,
457190 이수스페셜티케미컬,001800 오리온홀딩스,003090 대웅,012630 HDC,069260 TKG휴켐스,001060 JW중외제약,005850 에스엘,
007660 이수페타시스,017960 한국카본,075580 세진중공업,001570 금양,005180 빙그레,089590 제주항공,272450 진에어,002350 넥센타이어,
066970 엘앤에프,039030 이오테크닉스,403870 HPSP,277810 레인보우로보틱스,214150 클래시스,214450 파마리서치,141080 리가켐바이오,
095340 ISC,067310 하나마이크론,031980 피에스케이홀딩스,319660 피에스케이,036540 SFA반도체,005290 동진쎄미켐,064760 티씨케이,
101490 에스앤에스텍,222800 심텍,140860 파크시스템스,089030 테크윙,232140 와이씨,348370 엔켐,121600 나노신소재,078600 대주전자재료,
278280 천보,393890 더블유씨피,365340 성일하이텍,086450 동국제약,237690 에스티팜,085660 차바이오텍,068760 셀트리온제약,
298380 에이비엘바이오,950160 코오롱티슈진,310210 보로노이,328130 루닛,338220 뷰노,122870 와이지엔터테인먼트,253450 스튜디오드래곤,
192080 더블유게임즈,194480 데브시스터즈,225570 넥슨게임즈,060250 NHN KCP,181710 NHN,053800 안랩,272290 이녹스첨단소재,
090460 비에이치,213420 덕산네오룩스,042000 카페24,383310 에코프로에이치엔,018290 브이티,257720 실리콘투,237880 클리오,
200130 콜마비앤에이치,161890 한국콜마,033640 네패스,082920 비츠로셀,039200 오스코텍,087010 펩트론,096530 씨젠,376300 디어유,
195940 HK이노엔"""

US_MORE = """ACN Accenture,LIN Linde,NEE NextEra Energy,DHR Danaher,SPGI S&P Global,ADP ADP,MDT Medtronic,SYK Stryker,
BKNG Booking,CB Chubb,MMC Marsh McLennan,PLD Prologis,AMT American Tower,CI Cigna,ELV Elevance Health,CVS CVS Health,
SO Southern Company,DUK Duke Energy,ZTS Zoetis,VRTX Vertex,REGN Regeneron,BSX Boston Scientific,ICE Intercontinental Exchange,
CME CME Group,MCO Moody's,ITW Illinois Tool Works,EMR Emerson,ETN Eaton,PH Parker-Hannifin,NOC Northrop Grumman,
GD General Dynamics,LHX L3Harris,TDG TransDigm,CSX CSX,NSC Norfolk Southern,WM Waste Management,RSG Republic Services,
ECL Ecolab,SHW Sherwin-Williams,APD Air Products,FCX Freeport-McMoRan,NEM Newmont,DOW Dow,DD DuPont,ADI Analog Devices,
MRVL Marvell,NXPI NXP,MCHP Microchip,ON ON Semiconductor,MPWR Monolithic Power,CDNS Cadence,SNPS Synopsys,ANET Arista Networks,
FTNT Fortinet,ZS Zscaler,DDOG Datadog,NET Cloudflare,MDB MongoDB,TEAM Atlassian,WDAY Workday,ADSK Autodesk,TTD The Trade Desk,
OKTA Okta,TWLO Twilio,DOCU DocuSign,PINS Pinterest,SNAP Snap,RBLX Roblox,EA Electronic Arts,TTWO Take-Two,U Unity,
DKNG DraftKings,MAR Marriott,HLT Hilton,CMG Chipotle,YUM Yum! Brands,DPZ Domino's,LULU Lululemon,ROST Ross Stores,
ORLY O'Reilly,AZO AutoZone,EBAY eBay,ETSY Etsy,CHWY Chewy,BBY Best Buy,DG Dollar General,DLTR Dollar Tree,KR Kroger,
KHC Kraft Heinz,MDLZ Mondelez,GIS General Mills,HSY Hershey,CL Colgate-Palmolive,KMB Kimberly-Clark,EL Estee Lauder,
MNST Monster Beverage,KDP Keurig Dr Pepper,STZ Constellation Brands,BX Blackstone,KKR KKR,APO Apollo,PGR Progressive,
TRV Travelers,AIG AIG,MET MetLife,PRU Prudential,USB U.S. Bancorp,PNC PNC,TFC Truist,COF Capital One,XYZ Block,AFRM Affirm,
MSTR Strategy,MARA MARA Holdings,RIOT Riot Platforms,NU Nu Holdings,SE Sea,MELI MercadoLibre,BABA Alibaba,JD JD.com,
PDD PDD Holdings,BIDU Baidu,NIO NIO,LI Li Auto,XPEV XPeng,LCID Lucid,ENPH Enphase,FSLR First Solar,PLUG Plug Power,
CEG Constellation Energy,VST Vistra,GEV GE Vernova,OKLO Oklo,SMR NuScale,IONQ IonQ,RGTI Rigetti,QBTS D-Wave Quantum,
SOUN SoundHound,AI C3.ai,PATH UiPath,CVNA Carvana,DASH DoorDash,LYFT Lyft,RDDT Reddit,APP AppLovin,ALAB Astera Labs,
VRT Vertiv,HPQ HP,HPE Hewlett Packard Enterprise,WDC Western Digital,STX Seagate,NTAP NetApp,GLW Corning,TER Teradyne,
EXPE Expedia,CCL Carnival,RCL Royal Caribbean,NCLH Norwegian Cruise,DAL Delta,UAL United Airlines,AAL American Airlines,
LUV Southwest,CMI Cummins,PCAR PACCAR,URI United Rentals,GWW W.W. Grainger,FAST Fastenal,ODFL Old Dominion,JBHT J.B. Hunt,
HCA HCA Healthcare,MCK McKesson,COR Cencora,CAH Cardinal Health,IDXX IDEXX,DXCM Dexcom,EW Edwards Lifesciences,
ILMN Illumina,BIIB Biogen,HUM Humana,CNC Centene"""


def pool() -> list[tuple[str, str, str]]:
    """(티커, 이름, 시장) 목록. 같은 티커는 한 번만."""
    out: dict[str, tuple[str, str, str]] = {}
    for text, market in ((KR, "KR"), (KR_MORE, "KR"), (US, "US"), (US_MORE, "US")):
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
            db.set_setting(conn, KR_OFF, self.kiwoom is None)
            self.seeded = True
        kst = now.astimezone(KST)
        for ticker, market in db.practice_due(conn, now - REFRESH, RUN_EACH, kiwoom=self.kiwoom is not None, now=now):
            error, retry_at = None, None
            try:
                rows = self.kiwoom.kr_daily(ticker, kst.strftime("%Y%m%d")) if market == "KR" else prices.us_daily(ticker, self.http)
                if not rows:
                    error = "일봉이 비어 있어요"
                else:
                    db.save_prices(conn, ticker, rows)
            except Exception as e:
                log.warning("연습용 %s 일봉 받기 실패: %s", ticker, e)
                error, retry_at = str(e)[:200], now + RETRY
            db.practice_fetched(conn, ticker, now, error, retry_at, TRIES)
