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
  closed_at   TIMESTAMPTZ
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
  avg_buy_price      NUMERIC(18, 4) NOT NULL,
  return_pct         NUMERIC(8, 2) NOT NULL,
  holding_days       INT NOT NULL,
  reason_type        TEXT NOT NULL CHECK (reason_type IN ('stop', 'target', 'other')),
  reason_detail      TEXT NOT NULL DEFAULT '',
  lesson             TEXT NOT NULL CHECK (length(trim(lesson)) > 0),
  followed_rules     BOOLEAN NOT NULL,
  macro_snapshot_id  INT REFERENCES macro_snapshots(id),
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
