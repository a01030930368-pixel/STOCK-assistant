-- 개인 투자 보조 앱 스키마 (PostgreSQL)
-- docker compose 최초 실행 시 자동으로 적용됩니다.

-- 매매원칙과 위기 대응 원칙. 매매일지 탭 상단에 항상 표시.
CREATE TABLE principles (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('trading', 'crisis')),
  body        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 매크로 환경 스냅샷. 숫자는 2단계에서 API로 자동 수집, 전망·변수·시사점은 직접 입력.
CREATE TABLE macro_snapshots (
  id                SERIAL PRIMARY KEY,
  snapshot_date     DATE NOT NULL UNIQUE,
  kr_base_rate      NUMERIC(5, 2),
  us_base_rate      NUMERIC(5, 2),
  usdkrw            NUMERIC(10, 2),
  gdp_outlook       TEXT,
  inflation         NUMERIC(5, 2),
  us_inflation      NUMERIC(5, 2),
  key_variables     TEXT,
  implications      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 포지션: 한 종목의 매수부터 청산까지의 묶음. 종목별 매매일지.
CREATE TABLE positions (
  id          SERIAL PRIMARY KEY,
  ticker      TEXT NOT NULL,
  name        TEXT NOT NULL,
  market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  book_key    TEXT  -- 종목 일기장에서 만든 일지면 그 일기장 키
);

-- 매수 기록. 매수 전 체크리스트 5개 항목은 모두 필수.
CREATE TABLE buy_entries (
  id                 SERIAL PRIMARY KEY,
  position_id        INT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  trade_date         DATE NOT NULL,
  quantity           NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  price              NUMERIC(18, 4) NOT NULL CHECK (price > 0),
  reason             TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  scenario           TEXT NOT NULL DEFAULT '',
  risk_1             TEXT NOT NULL CHECK (length(trim(risk_1)) > 0),
  risk_2             TEXT NOT NULL CHECK (length(trim(risk_2)) > 0),
  risk_3             TEXT NOT NULL CHECK (length(trim(risk_3)) > 0),
  weight_pct         NUMERIC(5, 2) NOT NULL CHECK (weight_pct > 0 AND weight_pct <= 100),
  stop_price         NUMERIC(18, 4) NOT NULL CHECK (stop_price > 0),
  target_price       NUMERIC(18, 4) NOT NULL CHECK (target_price > 0),
  target_basis       TEXT NOT NULL CHECK (target_basis IN ('chart', 'percent')),
  macro_snapshot_id  INT REFERENCES macro_snapshots(id),
  fill_key           TEXT,
  context            JSONB,  -- 매수일 기준 매크로 값(워커가 채움)
  chart_png          TEXT,   -- 매수일까지의 차트 그림(data:image/png)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (stop_price < price AND price < target_price)
);

-- 매도 기록. 수익률과 보유 기간은 매수 기록에서 계산해 저장.
CREATE TABLE sell_entries (
  id                 SERIAL PRIMARY KEY,
  position_id        INT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  trade_date         DATE NOT NULL,
  quantity           NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  price              NUMERIC(18, 4) NOT NULL CHECK (price > 0),
  avg_buy_price      NUMERIC(18, 4),  -- 평단을 모르는 매도(키움 기록보다 먼저 산 주식)면 비어 있어요
  return_pct         NUMERIC(8, 2),
  holding_days       INT NOT NULL,
  reason_type        TEXT NOT NULL CHECK (reason_type IN ('stop', 'target', 'other')),
  reason_detail      TEXT NOT NULL DEFAULT '',
  lesson             TEXT NOT NULL CHECK (length(trim(lesson)) > 0),
  followed_rules     BOOLEAN NOT NULL,
  macro_snapshot_id  INT REFERENCES macro_snapshots(id),
  fill_key           TEXT,
  context            JSONB,  -- 매도일 기준 매크로 값(워커가 채움)
  chart_png          TEXT,   -- 매도일까지의 차트 그림(data:image/png)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 가격 알림. 매수 기록 저장 시 손절·익절 알림이 자동 생성됨.
CREATE TABLE alerts (
  id            SERIAL PRIMARY KEY,
  position_id   INT REFERENCES positions(id) ON DELETE CASCADE,
  ticker        TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('stop', 'target', 'custom')),
  direction     TEXT NOT NULL CHECK (direction IN ('below', 'above')),
  price         NUMERIC(18, 4) NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  triggered_at  TIMESTAMPTZ,
  memo          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alerts_active_idx ON alerts (ticker) WHERE active;

-- 증권사 잔고 동기화 결과. 워커가 매번 통째로 교체.
CREATE TABLE holdings (
  ticker       TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  market       TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  quantity     NUMERIC(18, 4) NOT NULL,
  avg_price    NUMERIC(18, 4) NOT NULL,
  cur_price    NUMERIC(18, 4) NOT NULL,
  eval_amount  NUMERIC(20, 2) NOT NULL,
  pnl          NUMERIC(20, 2) NOT NULL,
  pnl_pct      NUMERIC(8, 2) NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_summary (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_buy        NUMERIC(20, 2) NOT NULL,
  total_eval       NUMERIC(20, 2) NOT NULL,
  total_pnl        NUMERIC(20, 2) NOT NULL,
  total_pnl_pct    NUMERIC(8, 2) NOT NULL,
  est_deposit      NUMERIC(20, 2) NOT NULL,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 미국 주식 잔고 합계(달러). worker/app/db.py의 MIGRATIONS와 같아야 합니다.
CREATE TABLE us_account_summary (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_buy      NUMERIC(20, 4) NOT NULL,
  total_eval     NUMERIC(20, 4) NOT NULL,
  total_pnl      NUMERIC(20, 4) NOT NULL,
  total_pnl_pct  NUMERIC(8, 2) NOT NULL,
  exch_rate      NUMERIC(12, 4) NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 공공 API에서 가져온 최신 매크로 지표. 매크로 메모 작성 시 기본값으로 씁니다.
CREATE TABLE macro_indicators (
  code        TEXT PRIMARY KEY,
  value       NUMERIC(12, 4) NOT NULL,
  as_of       TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 종목 정보(뉴스·실적·재무). worker/app/db.py의 MIGRATIONS와 같아야 합니다.
CREATE TABLE stock_news (
  ticker        TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  source        TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  title_ko      TEXT,  -- 한국어 제목(미국 뉴스는 번역, 국내 뉴스는 원문)
  summary_ko    TEXT,  -- 한국어 요약(요약이 없으면 비어 있음)
  PRIMARY KEY (ticker, url)
);

CREATE TABLE stock_earnings (
  ticker        TEXT NOT NULL,
  period        TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  reported_on   DATE,
  eps_actual    NUMERIC(14, 4),
  eps_estimate  NUMERIC(14, 4),
  PRIMARY KEY (ticker, url, title)
);

CREATE TABLE stock_financials (
  ticker               TEXT NOT NULL,
  period               TEXT NOT NULL,
  revenue              NUMERIC(24, 2),
  operating_income     NUMERIC(24, 2),
  liabilities          NUMERIC(24, 2),
  equity               NUMERIC(24, 2),
  operating_cash_flow  NUMERIC(24, 2),
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, period)
);

CREATE TABLE stock_peers (
  ticker       TEXT NOT NULL,
  peer_ticker  TEXT NOT NULL,
  peer_name    TEXT NOT NULL,
  peer_market  TEXT NOT NULL CHECK (peer_market IN ('KR', 'US')),
  PRIMARY KEY (ticker, peer_ticker)
);

-- 계좌별 남은 예수금. 국내(KR)는 원, 미국(US)은 달러.
CREATE TABLE cash_balances (
  market      TEXT PRIMARY KEY CHECK (market IN ('KR', 'US')),
  currency    TEXT NOT NULL,
  deposit     NUMERIC(20, 4) NOT NULL,
  d2_deposit  NUMERIC(20, 4),
  orderable   NUMERIC(20, 4),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 다가오는 일정: 한국·미국 휴장일(거래소 달력)과 미국 보유 종목 실적 발표 예정일(Finnhub)
CREATE TABLE calendar_events (
  day     DATE NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('holiday', 'earnings', 'policy', 'economic', 'dividend')),
  market  TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  ticker  TEXT NOT NULL DEFAULT '',
  title   TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (day, kind, market, ticker, title)
);

-- 차트용 일봉 종가(국내 키움 ka10081, 미국 Stooq, 장중 현재가 스냅샷)
CREATE TABLE price_history (
  ticker  TEXT NOT NULL,
  day     DATE NOT NULL,
  open    NUMERIC(18, 4),
  high    NUMERIC(18, 4),
  low     NUMERIC(18, 4),
  close   NUMERIC(18, 4) NOT NULL,
  volume  NUMERIC(20, 0),
  PRIMARY KEY (ticker, day)
);

-- 차트 메모: 특정 날짜에 남긴 생각
CREATE TABLE chart_memos (
  id          SERIAL PRIMARY KEY,
  ticker      TEXT NOT NULL,
  day         DATE NOT NULL,
  body        TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 종목 검색기: 국내 거래대금 상위 종목의 지표 (워커가 30분마다 통째로 바꿈)
CREATE TABLE screener_stocks (
  ticker         TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  market         TEXT NOT NULL,
  day            DATE NOT NULL,
  price          NUMERIC(18, 4) NOT NULL,
  change_pct     NUMERIC(10, 2),
  trade_value    NUMERIC(22, 0) NOT NULL,
  volume_ratio   NUMERIC(10, 2),
  rsi14          NUMERIC(6, 2),
  ma5            NUMERIC(18, 4),
  ma20           NUMERIC(18, 4),
  ma20_gap_pct   NUMERIC(10, 2),
  golden_cross   BOOLEAN NOT NULL DEFAULT false,
  high_52w       NUMERIC(18, 4) NOT NULL,
  near_high_pct  NUMERIC(10, 2) NOT NULL,
  spark          NUMERIC[] NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 검색기 저장 조건
CREATE TABLE screener_presets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  rules       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO screener_presets (name, rules) VALUES
  ('거래대금 터진 종목', '{"minValueEok": 1500, "volRatioMin": 1.5, "chgMin": -5, "chgMax": 10}'),
  ('눌림목', '{"rsiMax": 35, "ma20": "below"}'),
  ('신고가 근접', '{"nearHighPct": 5}'),
  ('골든크로스', '{"goldenCross": true}');

-- 분봉(1분). 워커가 장중 2분마다 보유·관심 종목을 받아 최근 8일치만 보관
CREATE TABLE minute_bars (
  ticker  TEXT NOT NULL,
  ts      TIMESTAMPTZ NOT NULL,
  open    NUMERIC(18, 4) NOT NULL,
  high    NUMERIC(18, 4) NOT NULL,
  low     NUMERIC(18, 4) NOT NULL,
  close   NUMERIC(18, 4) NOT NULL,
  volume  NUMERIC(20, 0) NOT NULL DEFAULT 0,
  PRIMARY KEY (ticker, ts)
);

-- AI 한마디: 보유 종목별 하루 한 번 (ANTHROPIC_API_KEY가 있을 때만)
CREATE TABLE ai_comments (
  ticker      TEXT NOT NULL,
  day         DATE NOT NULL,
  tone        TEXT NOT NULL,
  body        TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, day)
);

-- 텔레그램 일정 알림·아침 브리핑을 보낸 기록(하루 한 번만 보내려고)
CREATE TABLE notices_sent (
  key      TEXT PRIMARY KEY,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 관심종목: 가지고 있지 않아도 목표가 알림을 걸어 둘 종목
CREATE TABLE watchlist (
  ticker      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  memo        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 잔고에 없는 관심종목의 현재가. 장중 2분마다 갱신
CREATE TABLE watch_quotes (
  ticker      TEXT PRIMARY KEY,
  price       NUMERIC(18, 4) NOT NULL,
  change_pct  NUMERIC(8, 2),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 종목 업종. sector는 자동(국내 키움, 미국 Finnhub), custom은 직접 고친 이름
CREATE TABLE stock_sectors (
  ticker      TEXT PRIMARY KEY,
  market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  sector      TEXT NOT NULL DEFAULT '',
  custom      TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 화면 설정 (예: 비중 한도 {"sectorMax":40,"stockMax":20,"cashMin":10})
CREATE TABLE app_settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

-- 배당 기록(야후). 배당락일과 주당 배당금
CREATE TABLE stock_dividends (
  ticker   TEXT NOT NULL,
  ex_date  DATE NOT NULL,
  amount   NUMERIC(18, 4) NOT NULL,
  PRIMARY KEY (ticker, ex_date)
);

-- 키움 체결(조회 전용). 하루·종목·매수/매도 한 묶음. fill_key = 시장:날짜:종목:buy|sell
CREATE TABLE trade_fills (
  fill_key    TEXT PRIMARY KEY,
  market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  trade_date  DATE NOT NULL,
  ticker      TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  side        TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity    NUMERIC(18, 4) NOT NULL,
  price       NUMERIC(18, 4) NOT NULL,
  fee         NUMERIC(18, 4),
  fill_time   TEXT,
  fill_count  INT NOT NULL DEFAULT 1,
  source      TEXT NOT NULL,
  hidden      BOOLEAN NOT NULL DEFAULT false,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 종목 일기장(첫 매수부터 전량 매도까지 한 권)의 사후강평. book_key = 시장:종목:전량 매도한 날
CREATE TABLE book_reviews (
  book_key        TEXT PRIMARY KEY,
  stars           INT CHECK (stars BETWEEN 1 AND 5),
  followed_rules  BOOLEAN,
  thesis          TEXT NOT NULL DEFAULT '',
  plan            TEXT NOT NULL DEFAULT '',
  exit_timing     TEXT NOT NULL DEFAULT '',
  lesson          TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 날마다 내 돈 전체(원화 환산). 주간 성적표에서 지난주와 비교할 때 써요.
CREATE TABLE asset_history (
  day    DATE PRIMARY KEY,
  total  NUMERIC(20, 2) NOT NULL
);

-- 차트에 그린 지지·저항. 가격 기준이라 분·일·주·월봉 어디서나 보여요. high가 NULL이면 선, 있으면 구간.
CREATE TABLE chart_levels (
  id          SERIAL PRIMARY KEY,
  ticker      TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL CHECK (kind IN ('support', 'resistance')),
  low         NUMERIC(18, 4) NOT NULL,
  high        NUMERIC(18, 4),
  memo        TEXT NOT NULL DEFAULT '',
  color       TEXT,                            -- 직접 고른 색. 없으면 지지 파랑, 저항 빨강
  alert       BOOLEAN NOT NULL DEFAULT false,  -- 가격이 닿으면 텔레그램
  last_price  NUMERIC(18, 4),                  -- 워커가 지난번에 본 가격(닿았는지 판단용)
  alerted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chart_levels_ticker_idx ON chart_levels (ticker);

-- 차트 낙서. 그린 차트(1분봉, 일봉 등)에서만 보여요. points = [[봉 키, 봉 안 위치(0~1), 가격], ...]
CREATE TABLE chart_doodles (
  id          SERIAL PRIMARY KEY,
  ticker      TEXT NOT NULL,
  view        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#c9a96b',
  points      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chart_doodles_ticker_idx ON chart_doodles (ticker, view);

-- 날짜 계산(CURRENT_DATE)을 한국 날짜로 합니다.
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Seoul'); END $$;

-- ISA 계좌(키움에서 계좌마다 키를 따로 받아요). 일반 계좌와 섞이지 않게 따로 둡니다.
CREATE TABLE isa_holdings (
  ticker       TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  quantity     NUMERIC(18, 4) NOT NULL,
  avg_price    NUMERIC(18, 4) NOT NULL,
  cur_price    NUMERIC(18, 4) NOT NULL,
  eval_amount  NUMERIC(20, 2) NOT NULL,
  pnl          NUMERIC(20, 2) NOT NULL,
  pnl_pct      NUMERIC(8, 2) NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE isa_summary (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_buy      NUMERIC(20, 2) NOT NULL,
  total_eval     NUMERIC(20, 2) NOT NULL,
  total_pnl      NUMERIC(20, 2) NOT NULL,
  total_pnl_pct  NUMERIC(8, 2) NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE isa_cash (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  deposit     NUMERIC(20, 4) NOT NULL,
  d2_deposit  NUMERIC(20, 4),
  orderable   NUMERIC(20, 4),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ISA 체결. 올해 산 금액(납입 한도 확인)에 씁니다.
CREATE TABLE isa_fills (
  fill_key    TEXT PRIMARY KEY,
  trade_date  DATE NOT NULL,
  ticker      TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  side        TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity    NUMERIC(18, 4) NOT NULL,
  price       NUMERIC(18, 4) NOT NULL,
  fee         NUMERIC(18, 4),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 보유 국내 종목의 DART 공시(접수 번호 하나에 한 줄). seen_at은 워커가 처음 본 시각이에요.
CREATE TABLE stock_disclosures (
  rcept_no   TEXT PRIMARY KEY,
  ticker     TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  filer      TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,
  important  BOOLEAN NOT NULL DEFAULT false,
  day        DATE NOT NULL,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary    TEXT  -- 중요한 공시를 AI가 숫자를 넣어 정리한 한 줄
);
CREATE INDEX stock_disclosures_ticker ON stock_disclosures (ticker, day DESC);

-- 날마다 원/달러 기준 환율(한국은행). 미국 주식을 산 날 환율을 찾는 데 써요.
CREATE TABLE fx_daily (
  day   DATE PRIMARY KEY,
  rate  NUMERIC(12, 4) NOT NULL
);

-- 종목 페이지 재무제표(손익·재무상태·현금흐름). kind: Y 연간, Q 분기(석 달), C 올해 누적
CREATE TABLE stock_statements (
  ticker      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('Y', 'Q', 'C')),
  period      TEXT NOT NULL,
  item        TEXT NOT NULL,
  value       NUMERIC(24, 2) NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, kind, period, item)
);

-- 실적 발표 한눈에: 실적이 나올 때마다 숫자 표·최근 분기·예상 대비·AI 해설. id는 KR:접수번호 또는 US:티커:분기
CREATE TABLE earnings_reports (
  id           TEXT PRIMARY KEY,
  ticker       TEXT NOT NULL,
  name         TEXT NOT NULL,
  market       TEXT NOT NULL,
  period       TEXT NOT NULL,
  reported_on  DATE NOT NULL,
  url          TEXT NOT NULL,
  data         JSONB NOT NULL,
  ai           TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX earnings_reports_ticker ON earnings_reports (ticker, reported_on DESC);

-- PER·PBR 밴드용 보통주 수(국내 유통주식수, 미국 표지 주식 수)
CREATE TABLE stock_shares (
  ticker      TEXT PRIMARY KEY,
  shares      NUMERIC(20, 0) NOT NULL,
  as_of       DATE NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 섹터 동향: 지금 지수·등락률·비중(지도 크기)·오늘 많이 움직인 종목, 그리고 지난 종가
CREATE TABLE sector_index (
  market      TEXT NOT NULL CHECK (market IN ('KR', 'US')),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  price       NUMERIC(18, 4) NOT NULL,
  change_pct  NUMERIC(8, 2) NOT NULL,
  weight      NUMERIC(10, 4),
  leaders     JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (market, code)
);

CREATE TABLE sector_daily (
  market  TEXT NOT NULL,
  code    TEXT NOT NULL,
  day     DATE NOT NULL,
  close   NUMERIC(18, 4) NOT NULL,
  PRIMARY KEY (market, code, day)
);
